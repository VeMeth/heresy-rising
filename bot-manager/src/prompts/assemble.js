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
// prompts/budget.js, so the whole user message targets ~3,000 input tokens
// even in a long, chatty game on an 8k-context local model.

import { STATIC_RULES } from './staticRules.js';
import { roleBlock } from './roleBlocks.js';
import { gameStateBlock, factionChatBlock, personaBlock } from './gameState.js';
import { BUDGETS, MIN_CHAT_LINES, estimateTokens, fitLines, fitToBudget } from './budget.js';

export function assembleMessages({ session, prompt } = {}) {
  return {
    system: getOrBuildSystemPrompt(session),
    user: buildUserMessage({ session, prompt })
  };
}

function getOrBuildSystemPrompt(session) {
  if (!session) return buildSystemPrompt(null);
  const key = [
    session.role || 'none',
    session.faction || 'none',
    session.talkativeness ?? '',
    JSON.stringify(session.personaOverrides || null),
    session._config?.botFactionChat ? 1 : 0,
    session._config?.llmNoThink === false ? 0 : 1
  ].join('|');
  if (session._systemPromptCache && session._systemPromptCacheKey === key) return session._systemPromptCache;
  const built = buildSystemPrompt(session);
  session._systemPromptCache = built;
  session._systemPromptCacheKey = key;
  return built;
}

export function buildSystemPrompt(session) {
  const blocks = [STATIC_RULES, roleBlock(session?.role || null)];
  if (session?._config?.botFactionChat) {
    const faction = factionChatBlock(session);
    if (faction) blocks.push(faction);
  }
  const persona = personaBlock(session);
  if (persona) blocks.push(persona);
  let out = blocks.filter(Boolean).join('\n\n---\n\n');
  if (session?._config?.llmNoThink !== false) out += '\n\n/no_think';
  return out;
}

function buildUserMessage({ session, prompt } = {}) {
  const parts = [];

  // 1. State digest (~150 tok).
  parts.push(gameStateBlock(session));

  // 2. Rolling summary (~200 tok) — deterministic, code-built (memory.js).
  const summaryText = typeof session?.rollingSummary?.render === 'function' ? session.rollingSummary.render() : '';
  if (summaryText) parts.push(`## WHAT HAS HAPPENED SO FAR\n${fitToBudget(summaryText, BUDGETS.rollingSummary)}`);

  // 3. Notes (~150 tok) — StructuredNotes is already capped at 15 keys.
  const notesLines = renderNotes(session);
  if (notesLines.length) parts.push(`## YOUR NOTES\n${fitLines(notesLines, BUDGETS.notes).join('\n')}`);

  // 4. Recent chat (~800 tok, min 6 kept, newest last) — the ONLY place chat
  // history appears; gameStateBlock deliberately does not duplicate it.
  const chatLines = renderRecentChat(session);
  const kept = fitLines(chatLines, BUDGETS.recentChat, { minKeep: Math.min(MIN_CHAT_LINES, chatLines.length) });
  if (kept.length) parts.push(`## RECENT CHAT\n${kept.join('\n')}`);

  // 5. Turn instruction (~120 tok).
  parts.push(turnInstruction({ session, prompt }));

  return parts.filter(Boolean).join('\n\n');
}

function renderNotes(session) {
  const all = session?.notes && typeof session.notes.all === 'function' ? session.notes.all() : {};
  return Object.entries(all).map(([k, v]) => `- ${k}: ${v}`);
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

function turnInstruction({ session, prompt } = {}) {
  const kind = prompt?.kind;
  if (kind === 'chat_turn') {
    const reason = prompt.reason ? ` (${prompt.reason})` : '';
    return `## YOUR TURN TO SPEAK${reason}\nYou may post ONE public chat message, or pass. ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  if (kind === 'day_vote_prompt') {
    const legal = Array.isArray(prompt.legalTargets) && prompt.legalTargets.length
      ? `${prompt.legalTargets.join(', ')}, or "skip"`
      : 'any living player, or "skip"';
    return `## VOTE\nRound ${session?.round ?? '?'}. Cast your vote: ${legal}. Justify it briefly. ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  if (kind === 'night_action_prompt') {
    return `## NIGHT ACTION\nRound ${session?.round ?? '?'}. Take your night action (see YOUR ROLE above), or sleep. ${ALWAYS}\n\nRespond with a JSON action object.`;
  }
  return `## EVENT\n${JSON.stringify(prompt)}\n\n${ALWAYS}\n\nRespond with a JSON action object.`;
}

// Re-exported for tests/tools that want to measure the assembled user
// message against the ~3k input-token target without re-implementing it.
export { estimateTokens };
