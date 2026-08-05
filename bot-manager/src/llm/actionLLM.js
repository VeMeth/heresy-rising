import { parseActionBlock, normalizeAction, stripThink } from './parseAction.js';
import { assembleMessages } from '../prompts/assemble.js';
import { recordSpend } from './registry.js';
import { recordThought } from '../thoughts.js';

const NUDGE_PREFIX = 'Your previous response did not include a valid JSON action. Re-emit ONLY the JSON action object (a ```action fenced block is also accepted), matching the schema. Your previous output (truncated):\n';
const NUDGE_MAX_ECHO = 400;
const NUDGE_ONLY_REASONING = 'Your previous response contained only reasoning and was cut off before the action.';
const NUDGE_TRUNCATED = 'Do not explain. Emit ONLY the JSON action object.';

// Rough char/4 fallback token estimate for servers that omit `usage` — kept
// separate from prompts/budget.js's ceil(len/3.5), which estimates INPUT
// tokens for prompt assembly; this one estimates OUTPUT tokens and is
// calibrated independently.
function estimateTokens(str) { return Math.ceil((str || '').length / 4); }

// Recovers whatever stripThink() (parseAction.js) would have DELETED from a
// raw response, rather than what it keeps — this is the free reasoning
// capture for local Qwen3 (BOT_THOUGHTS_FEED_PLAN.md §2.2 item 1): that
// profile emits stray <think> blocks even under /no_think, and today that
// text is thrown away entirely. Deliberately NOT implemented as a diff
// against stripThink's output (fragile — stripThink trims/reflows) and
// deliberately NOT a change to stripThink itself (not this file's export,
// and other code depends on its exact surviving-text behaviour). Instead
// this mirrors stripThink's three cases and captures the opposite side of
// each one:
//   1. closed <think>...</think> blocks — capture their inner text.
//   2. an unclosed trailing <think> (generation cut off mid-thought) —
//      capture everything from the tag to the end.
//   3. an orphan </think> with no opener (MiniMax pre-fills the opening tag
//      server-side) — capture everything up to the last such tag.
// Returns null (not '') when there was nothing to capture, so callers can
// cleanly fall back to `response.reasoningText` vs. this vs. null.
function extractRemovedThink(raw) {
  if (!raw) return null;
  const text = String(raw);
  const closedMatches = [...text.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
  let removed = closedMatches.map((m) => m[1]).join('\n');

  const afterClosedRemoval = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openIdx = afterClosedRemoval.search(/<think>/i);
  if (openIdx !== -1) {
    const tail = afterClosedRemoval.slice(openIdx + '<think>'.length);
    removed = removed ? `${removed}\n${tail}` : tail;
  } else {
    const closeIdx = afterClosedRemoval.toLowerCase().lastIndexOf('</think>');
    if (closeIdx !== -1) {
      const head = afterClosedRemoval.slice(0, closeIdx);
      removed = removed ? `${removed}\n${head}` : head;
    }
  }
  const trimmed = removed && removed.trim();
  return trimmed || null;
}

// Fallback for the sessionless/test path (existing tests call
// ActionLLM.generate with minimal fake sessions that have no `_profile`) and
// for any profile that genuinely charges nothing (`local`). Zero price means
// the cost-accrual maths below is a no-op regardless of token counts.
const ZERO_COST_PROFILE = { usdPerMTokIn: 0, usdPerMTokOut: 0 };

// ActionLLM wraps a plain OpenAI-compatible chat client (OpenAIChat or
// MockChatLLM) and implements the same `generate({ session, prompt })`
// interface as PassThroughLLM that BotSession consumes. The orchestrator:
//   1. Assembles {system, user} from the prompt builder.
//   2. Calls the chat model.
//   3. Parses the response; on failure retries once with a short "fix your
//      action" nudge (echoing only a short excerpt of the bad output, not
//      the full prior exchange — keeps the retry cheap on an 8k context).
//   4. On second failure, the bot passes the turn.
export class ActionLLM {
  /**
   * @param {object} params
   * @param {{chat:(messages:any[])=>Promise<{content:string,usage?:object,finishReason?:string,reasoningText?:string}>}} params.chatModel
   * @param {typeof assembleMessages} [params.promptBuilder]
   * @param {number} [params.maxRetries]
   */
  constructor(params) {
    const { chatModel, promptBuilder = assembleMessages, maxRetries = 1 } = params;
    if (!chatModel) throw new Error('ActionLLM requires chatModel');
    this._chat = chatModel;
    this._promptBuilder = promptBuilder;
    this._maxRetries = Math.max(0, Number(maxRetries) | 0);
    this._label = 'actionLLM';
  }

  /** @param {{session:object,prompt:object}} params */
  async generate(params) {
    const { session, prompt } = params;
    const { system, user } = this._promptBuilder({ session, prompt });
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];

    const attempts = this._maxRetries + 1; // initial + retries
    let lastText = '';
    for (let i = 0; i < attempts; i++) {
      let response;
      const startedAt = Date.now();
      try {
        response = await this._chat.chat(messages);
      } catch (e) {
        console.warn(`[actionLLM] chat call failed (attempt ${i + 1}/${attempts}):`, e.message);
        break;
      }
      const latencyMs = Date.now() - startedAt;
      lastText = String(response?.content ?? '');
      const usage = response?.usage || {};

      // Cost accounting (plan §3.5) — split input/output rather than reading
      // a single total, so a paid profile can be billed at its distinct
      // in/out rates. `usage.total_tokens`, when the server sends it, is
      // still authoritative for tokensUsed (the pre-existing budget-gate
      // signal); prompt_tokens/completion_tokens (or, failing those, the
      // char-estimate fallback) drive the USD split independently, since a
      // server that reports total_tokens without a breakdown still needs a
      // cost estimate to bill against.
      const inTok = Number(usage.prompt_tokens) || estimateTokens(system) + estimateTokens(user);
      const outTok = Number(usage.completion_tokens) || estimateTokens(lastText);
      const totalTokens = Number(usage.total_tokens) || (inTok + outTok);
      if (session?.tokensUsed !== undefined) session.tokensUsed += totalTokens;

      const profile = session?._profile || ZERO_COST_PROFILE;
      const deltaUsd = (inTok / 1e6) * (profile.usdPerMTokIn || 0) + (outTok / 1e6) * (profile.usdPerMTokOut || 0);
      if (deltaUsd > 0) {
        if (session && session.costUsd !== undefined) session.costUsd += deltaUsd;
        recordSpend(deltaUsd); // process-wide rolling 24h spend (registry.js BOT_DAILY_USD_CAP guard)
      }

      // Reasoning tokens are already inside usage.completion_tokens (and thus
      // already billed above via outTok) — this is admin visibility only,
      // never a second charge.
      const reasoningTok = Number(usage.completion_tokens_details?.reasoning_tokens) || 0;
      if (reasoningTok > 0 && session) session.reasoningTokens = (session.reasoningTokens || 0) + reasoningTok;

      const parsed = parseActionBlock(lastText);
      const action = parsed ? normalizeAction(parsed) : null;

      // Feed capture (plan §2.2 item 1) — one 'thinking' entry per attempt,
      // but ONLY for profiles that actually reason (profile.captureThoughts:
      // the MiniMax profiles). The `local` profile runs /no_think at a
      // 350-token cap and has essentially nothing to say here, so recording
      // it would emit a thought-less entry on every single LLM call and, in a
      // 500-entry SHARED ring buffer, steadily evict the MiniMax reasoning
      // and the action history that are the point of the feed. Local bots
      // still appear in the feed via session.js's _logAction mirror — actions,
      // rejections and suppressions — just without thinking noise.
      //
      // On a SUCCESSFUL parse, no 'thinking' entry is emitted here: the
      // reasoning is stashed on the session and folded into the single
      // 'action'/'chat'/'pass' entry that _act() logs next, so a vote read as
      // one feed entry ("voted X — reasoning: …") rather than two. A FAILED
      // parse followed by a retry keeps emitting per-attempt 'thinking'
      // entries here (each failed attempt has no matching action entry to
      // carry its reasoning).
      //
      // reasoningText (MiniMax reasoning_split) wins when present; otherwise
      // fall back to whatever stripThink() would have discarded. Wrapped
      // defensively — recordThought() itself never throws, but this call site
      // must not be able to break a bot's turn either.
      try {
        const thought = response?.reasoningText || extractRemovedThink(lastText);
        if (action) {
          // Fold the reasoning into the upcoming _act() entry instead of
          // emitting a separate 'thinking' entry (one feed entry per turn).
          if (session) session._pendingThought = { thought, attempt: i + 1 };
        } else if (!session?._profile || session?._profile?.captureThoughts) {
          recordThought({
            conclaveCode: session?.conclaveCode,
            botId: session?.id,
            playerCode: session?.playerCode,
            botName: session?.name,
            profileId: session?.profileId,
            role: session?.role,
            faction: session?.faction,
            round: session?.round,
            phase: session?.phase,
            kind: 'thinking',
            summary: `attempt ${i + 1}: failed to parse${response?.finishReason === 'length' ? ' (truncated)' : ''}`,
            thought,
            detail: {
              promptKind: prompt?.kind,
              attempt: i + 1,
              latencyMs,
              finishReason: response?.finishReason,
              inTok,
              outTok,
              totalTokens,
              parsed: false,
              actionKind: null
            }
          });
        }
      } catch { /* observability must never break a bot's turn */ }

      if (action) return action;

      // Retry with a short nudge only — reset to [system, user] rather than
      // accumulating the bad response, so the retry stays small on an 8k
      // context window. This is also load-bearing for MiniMax: a thinking
      // trace must be round-tripped complete or not at all, so a truncated
      // response must never be appended to `messages` as an assistant turn —
      // do not "fix" this into a conventional multi-turn append.
      if (i < attempts - 1) {
        if (response?.finishReason === 'length') {
          // Distinct from an ordinary parse miss — today (pre-A3) this case
          // is invisible; once finishReason lands it tells us the generation
          // was cut off by maxTokens rather than the model simply omitting
          // JSON, which calls for a terse retry instead of an echo.
          console.warn(`[actionLLM] output_truncated (attempt ${i + 1}/${attempts}): response hit the token cap before an action could be emitted`);
          messages.length = 2;
          messages.push({ role: 'user', content: NUDGE_TRUNCATED });
        } else {
          // Echo the think-stripped text, not the raw response — on MiniMax
          // the raw text is often the first NUDGE_MAX_ECHO chars of a
          // <think> block, which is noise, not a useful excerpt of the bad
          // output.
          const stripped = stripThink(lastText);
          const excerpt = stripped ? stripped.slice(0, NUDGE_MAX_ECHO) : NUDGE_ONLY_REASONING;
          messages.length = 2;
          messages.push({ role: 'user', content: `${NUDGE_PREFIX}${excerpt}` });
        }
      }
    }
    return { kind: 'pass' };
  }
}
