// Assembles the message list passed to the chat model. Per spec § "Persona
// System Prompt": four blocks (static rules, role block, game state block,
// persona overrides) plus reinjected notes + history + the engine's prompt
// event as the user turn.

import { STATIC_RULES } from './staticRules.js';
import { roleBlock } from './roleBlocks.js';
import { gameStateBlock, factionChatBlock, personaBlock } from './gameState.js';

export function assembleMessages({ session, prompt } = {}) {
  const blocks = [STATIC_RULES];
  blocks.push(roleBlock(session?.role || null));
  blocks.push(gameStateBlock(session));
  const faction = factionChatBlock(session);
  if (faction) blocks.push(faction);
  const persona = personaBlock(session);
  if (persona) blocks.push(persona);

  // Inject the bot's own long-term notes as an explicit system block so the
  // model treats them as persistent memory the bot previously decided to keep.
  if (session?.notes && typeof session.notes.all === 'function' && session.notes.size > 0) {
    blocks.push(`## YOUR LONG-TERM NOTES\n${JSON.stringify(session.notes.all(), null, 2)}`);
  }

  const system = blocks.filter(Boolean).join('\n\n---\n\n');

  // History: render short-term memory (chat, intel_return, announcement, etc.)
  // as user-side messages in the message array.
  const history = (session?.shortTermMemory?.items || []).map((it) => ({
    role: 'user',
    content: `[${seqLabel(it)}${it.from ? ' from ' + it.from : ''}${it.author ? ' (' + it.author + ')' : ''}] ${seqBody(it)}`
  }));

  const userPrompt = `Round ${session?.round ?? '?'}, phase ${session?.phase ?? '?'}, alive=${session?.alive ? 'yes' : 'no'}. Conclave: ${session?.conclaveCode ?? '?'}. Your player code: ${session?.playerCode ?? '?'}.

Engine event:
${JSON.stringify(prompt)}`;

  return { system, history, user: userPrompt };
}

function seqLabel(it) {
  if (it.kind === 'chat_message') return 'chat_message';
  if (it.kind === 'announcement') return 'announcement';
  if (it.kind === 'intel_return') return 'intel_return';
  if (it.kind === 'phase_change') return 'phase_change';
  return it.kind || 'event';
}
function seqBody(it) {
  if (it.kind === 'chat_message') return it.text || '';
  if (it.kind === 'announcement') return `${it.title || it.type || ''}: ${it.message || ''}`;
  if (it.kind === 'intel_return') return JSON.stringify({ ...(it.zone ? { zone: it.zone } : {}), ...(it.result ? { result: it.result } : {}), ...(it.faction ? { faction: it.faction } : {}), ...(it.intelKind ? { intelKind: it.intelKind } : {}) });
  if (it.text) return it.text;
  return JSON.stringify(it);
}