import { parseActionBlock, normalizeAction } from './parseAction.js';
import { assembleMessages } from '../prompts/assemble.js';

const NUDGE_PREFIX = 'Your previous response did not include a valid JSON action. Re-emit ONLY the JSON action object (a ```action fenced block is also accepted), matching the schema. Your previous output (truncated):\n';
const NUDGE_MAX_ECHO = 400;

// Rough char/4 fallback token estimate for servers that omit `usage` — kept
// separate from prompts/budget.js's ceil(len/3.5), which estimates INPUT
// tokens for prompt assembly; this one estimates OUTPUT tokens and is
// calibrated independently.
function estimateTokens(str) { return Math.ceil((str || '').length / 4); }

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
  constructor({ chatModel, promptBuilder = assembleMessages, maxRetries = 1 } = {}) {
    if (!chatModel) throw new Error('ActionLLM requires chatModel');
    this._chat = chatModel;
    this._promptBuilder = promptBuilder;
    this._maxRetries = Math.max(0, Number(maxRetries) | 0);
    this._label = 'actionLLM';
  }

  async generate({ session, prompt } = {}) {
    const { system, user } = this._promptBuilder({ session, prompt });
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];

    const attempts = this._maxRetries + 1; // initial + retries
    let lastText = '';
    for (let i = 0; i < attempts; i++) {
      let response;
      try {
        response = await this._chat.chat(messages);
      } catch (e) {
        console.warn(`[actionLLM] chat call failed (attempt ${i + 1}/${attempts}):`, e.message);
        break;
      }
      lastText = String(response?.content ?? '');
      const usage = response?.usage || {};
      const totalTokens = Number(usage.total_tokens) || (estimateTokens(system) + estimateTokens(user) + estimateTokens(lastText));
      if (session?.tokensUsed !== undefined) session.tokensUsed += totalTokens;

      const parsed = parseActionBlock(lastText);
      const action = parsed ? normalizeAction(parsed) : null;
      if (action) return action;

      // Retry with a short nudge only — reset to [system, user] rather than
      // accumulating the bad response, so the retry stays small on an 8k
      // context window.
      if (i < attempts - 1) {
        const excerpt = lastText.slice(0, NUDGE_MAX_ECHO);
        messages.length = 2;
        messages.push({ role: 'user', content: `${NUDGE_PREFIX}${excerpt}` });
      }
    }
    return { kind: 'pass' };
  }
}
