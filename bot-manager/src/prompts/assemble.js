// Assembles the {system, user} pair passed to the chat model.
//
// `system` is byte-stable per bot per game (a pure function of role, faction,
// persona overrides, and talkativeness) — cached on the session object so
// repeated calls reuse the same string, both for our own performance and so
// an LM Studio-side KV-cache can reuse the shared prefix. It carries the
// static rules, role block, and persona/faction blocks — never chat history
// or game state, which are volatile and change every call.
//
// `user` is the volatile turn: state digest, rolling summary, notes, recent
// chat, and the turn instruction — each trimmed to its own token budget by
// prompts/budget.js. For the `local` profile (scale 1) that targets ~3,000
// input tokens even in a long, chatty game on an 8k-context model. Cloud
// profiles (MiniMax M2.7/M3) carry a `budgetScale` on `session._profile`
// that scales every one of those per-section budgets up uniformly, so a
// big-context bot sees proportionally more of the game instead of the same
// 8k-shaped tail — see prompts/budget.js and BOT_MODEL_PROFILES_PLAN.md §3.6.

import { staticRulesFor } from './staticRules.js';
import { roleBlockFor } from './roleBlocks.js';
import { gameStateBlock, factionChatBlock, personaBlock } from './gameState.js';
import { budgetsFor, minChatLinesFor, estimateTokens, fitLines, fitToBudget } from './budget.js';

/** @param {{session:object,prompt:object}} params */
export function assembleMessages(params) {
  const { session, prompt } = params;
  return {
    system: getOrBuildSystemPrompt(session),
    user: buildUserMessage({ session, prompt })
  };
}

function getOrBuildSystemPrompt(session) {
  if (!session) return buildSystemPrompt(null);
  // A profile change implies a prompt change (different noThinkSuffix,
  // different downstream budgets that don't live in `system` but still mark
  // this as "a different bot shape") — key on profile.id, not the old
  // _config.llmNoThink term, so the cache never serves a local-shaped
  // prompt to a cloud bot (or vice versa) after a profile switch.
  const key = [
    session.role || 'none',
    session.faction || 'none',
    session.talkativeness ?? '',
    JSON.stringify(session.personaOverrides || null),
    session._config?.botFactionChat ? 1 : 0,
    session._profile?.id || session.profileId || 'local'
  ].join('|');
  if (session._systemPromptCache && session._systemPromptCacheKey === key) return session._systemPromptCache;
  const built = buildSystemPrompt(session);
  session._systemPromptCache = built;
  session._systemPromptCacheKey = key;
  return built;
}

export function buildSystemPrompt(session) {
  const blocks = [staticRulesFor(session?._profile), roleBlockFor(session?.role || null, session?._profile)];
  if (session?._config?.botFactionChat) {
    const faction = factionChatBlock(session);
    if (faction) blocks.push(faction);
  }
  const persona = personaBlock(session);
  if (persona) blocks.push(persona);
  let out = blocks.filter(Boolean).join('\n\n---\n\n');
  // `/no_think` is a Qwen3 convention; MiniMax cannot disable thinking and
  // it would just be junk tokens in the cached prefix. Default true (the
  // `local` profile's value) when no profile is resolved, so a bare/legacy
  // session behaves exactly as before.
  if (session?._profile?.noThinkSuffix ?? true) out += '\n\n/no_think';
  return out;
}

/** @param {{session:object,prompt:object}} params */
function buildUserMessage(params) {
  const { session, prompt } = params;
  const parts = [];
  const budgets = budgetsFor(session?._profile);
  const minChatLines = minChatLinesFor(session?._profile);

  // 1. State digest (~150 tok at scale 1, scaled per profile).
  parts.push(gameStateBlock(session));

  // 2. Rolling summary (~200 tok at scale 1) — deterministic, code-built (memory.js).
  const summaryText = typeof session?.rollingSummary?.render === 'function' ? session.rollingSummary.render() : '';
  if (summaryText) parts.push(`## WHAT HAS HAPPENED SO FAR\n${fitToBudget(summaryText, budgets.rollingSummary)}`);

  // 2.5. Phase summaries (~800 tok at scale 1, empty for local profiles) —
  // LLM-generated end-of-phase recaps, written by the director's tick loop
  // on every phase transition for profiles with `consolidateAtPhaseEnd`.
  // Sits BETWEEN the rolling summary (the last ~20 events, no per-phase
  // boundary) and the notes (curated by the bot itself) so the bot sees
  // recent events first, then progressively older phase-shaped memory,
  // then its own annotations. Empty for non-cloud bots — the section is
  // omitted entirely when there's nothing to render.
  const phaseSummariesText = renderPhaseSummaries(session);
  if (phaseSummariesText) parts.push(`## PHASE SUMMARIES\n${fitToBudget(phaseSummariesText, budgets.phaseSummaries)}`);

  // 3. Notes (~150 tok at scale 1) — StructuredNotes is capped per-instance
  // (default 15 keys, scaled per profile — see memory.js).
  const notesLines = renderNotes(session);
  if (notesLines.length) parts.push(`## YOUR NOTES\n${fitLines(notesLines, budgets.notes).join('\n')}`);

  // 4. Recent chat (~800 tok at scale 1, min N kept, newest last) — the ONLY
  // place chat history appears; gameStateBlock deliberately does not
  // duplicate it. N (minChatLines) scales per profile: 6 local / 20 m2.7 / 40 m3.
  const chatLines = renderRecentChat(session);
  const kept = fitLines(chatLines, budgets.recentChat, { minKeep: Math.min(minChatLines, chatLines.length) });
  if (kept.length) parts.push(`## RECENT CHAT\n${kept.join('\n')}`);

  // 5. Turn instruction (~120 tok at scale 1).
  parts.push(turnInstruction({ session, prompt }));

  return parts.filter(Boolean).join('\n\n');
}

function renderNotes(session) {
  const all = session?.notes && typeof session.notes.all === 'function' ? session.notes.all() : {};
  return Object.entries(all).map(([k, v]) => `- ${k}: ${v}`);
}

function renderPhaseSummaries(session) {
  const list = Array.isArray(session?.phaseSummaries) ? session.phaseSummaries : [];
  if (!list.length) return '';
  return list.map((s) => {
    const header = `### Round ${s.round ?? '?'} ${s.phase || '?'}`;
    return `${header}\n${s.summary || ''}`;
  }).join('\n\n');
}

function renderRecentChat(session) {
  const items = (session?.shortTermMemory?.items || []).filter((it) => it.kind === 'chat_message');
  const names = session?.playerNames || {};
  return items.map((m) => {
    const isSelf = m.from === session?.playerCode;
    const label = isSelf ? `${m.author || 'You'} (you)` : (m.author || names[m.from] || m.from || '?');
    return `${label}: ${m.text || ''}`;
  });
}

const ALWAYS = 'If you have nothing new to add, emit {"kind":"pass"}.';

/** @param {{session:object,prompt:object}} params */
function turnInstruction(params) {
  const { session, prompt } = params;
  const kind = prompt?.kind;
  if (kind === 'chat_turn') {
    const reason = prompt.reason ? ` (${prompt.reason})` : '';
    const votingEnabled = session?.phase === 'day' && session?.round !== 1;
    const voteNote = votingEnabled
      ? ' If something just said changes your mind, cast a revised vote instead ({"kind":"vote"}) rather than waiting for next round — otherwise your existing vote stands.'
      : '';
    return `## YOUR TURN TO SPEAK${reason}\nYou may post ONE public chat message, or pass. Keep it to 1-3 sentences (~40 words), making a single point — no recaps, no summaries.${voteNote} ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  if (kind === 'day_vote_prompt') {
    const legal = Array.isArray(prompt.legalTargets) && prompt.legalTargets.length
      ? `${prompt.legalTargets.join(', ')}, or "skip"`
      : 'any living player, or "skip"';
    return `## VOTE\nRound ${session?.round ?? '?'}. Cast your vote: ${legal}. Justify it in ONE short sentence. ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  if (kind === 'night_action_prompt') {
    return `## NIGHT ACTION\nRound ${session?.round ?? '?'}. Take your night action (see YOUR ROLE above), or sleep. ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  return `## EVENT\n${JSON.stringify(prompt)}\n\n${ALWAYS}\n\nRespond with a JSON action object.`;
}

// Re-exported for tests/tools that want to measure the assembled user
// message against the ~3k input-token target without re-implementing it.
export { estimateTokens };
