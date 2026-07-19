// Translates the bot wire-format `action` (per spec) into the engine's
// `submitAction`/`sendMessage`/`vote` Socket.IO payloads. The spec uses canonical
// verbs for the bot; the engine derives the action from the player's role,
// and only needs a subset of fields.

import { normalizeAction } from './llm/parseAction.js';

// Per-role "verb" -> engine-handled intent. We rely on the engine's role
// lookup to apply the right `kind`. The bot's only jobs are: pick the target,
// pick the variant (T# for interrogator, sermon id for Priest), pick a
// channel for chat, or skip.
function verbToIntent(verb, session) {
  switch (verb) {
    case 'interrogate': return { engineType: 'action', variantFrom: 'tier' };
    case 'sermon':      return { engineType: 'action', variantFrom: 'sermonTier' };
    case 'protect':
    case 'bodyguard':
    case 'scan_drift':
    case 'trap':
    case 'kill':
    case 'recruit':    return { engineType: 'action', variantFrom: null };
    case 'forge':      return { engineType: 'action', variantFrom: null, day: true, forge: true };
    default:           return { engineType: 'unknown' };
  }
}

function tierToVariant(action) {
  return action.tier != null ? `T${Number(action.tier)}` : null;
}

// Returns either { type:'action' | 'vote' | 'chat', payload } or null (when
// the action is sleep/pass/no-emit).
export function buildEnginePayload(action, session) {
  const clean = normalizeAction(action);
  if (!clean) return null;
  if (clean.kind === 'pass') return { type: 'pass', payload: null };

  if (clean.kind === 'chat') {
    return { type: 'chat', payload: { code: session.conclaveCode, channel: 'public', body: String(clean.text || '').slice(0, 1000) } };
  }

  if (clean.kind === 'vote') {
    return { type: 'vote', payload: {
      code: session.conclaveCode,
      targetCode: clean.target || 'skip',
      justification: String(clean.justification || '')
    } };
  }

  // night_action
  const verb = clean.verb;
  if (!verb) return null;
  if (verb === 'sleep') return { type: 'sleep', payload: null };
  const intent = verbToIntent(verb, session);
  if (intent.engineType !== 'action') return null;
  let variant = null;
  if (intent.variantFrom === 'tier') variant = tierToVariant(clean);
  else if (intent.variantFrom === 'sermonTier') variant = clean.sermonTier ?? null;
  const payload = {
    code: session.conclaveCode,
    targetCode: clean.target || null,
    variant
  };
  if (intent.forge) {
    payload.asPlayerCode = clean.asPlayerCode || null;
    payload.body = clean.text || clean.body || null;
  }
  return { type: 'action', payload };
}