// Translates the bot wire-format `action` (per spec) into the engine's
// `submitAction`/`sendMessage`/`vote` Socket.IO payloads. The spec uses canonical
// verbs for the bot; the engine derives the action from the player's role,
// and only needs a subset of fields.

import { normalizeAction } from './llm/parseAction.js';

const DEFAULT_MAX_CHAT_CHARS = 400;
// Hard engine-side ceiling (heresyGameManager.sendMessage slices at 1000);
// never emit more than the engine would store, whatever a profile asks for.
const ENGINE_BODY_LIMIT = 1000;

// Trims bot-authored prose to the profile's `maxChatChars` at the nicest
// boundary available, preferring a sentence end, then a word end, then a hard
// cut. Verbose models (MiniMax M2.7/M3 especially) routinely write several
// paragraphs where a table expects one line; the prompt asks for 1-3
// sentences, and this is what makes that stick when the model ignores it.
//
// Trimming rather than rejecting is deliberate: an over-long message used to
// fail validation outright, which made the bot silent for the turn — a much
// worse outcome than a message cut short. Never returns an empty string for
// non-empty input, because a vote justification is REQUIRED for a crippled
// bot (session.js checks crippleTier >= 2) and emptying it would get the
// whole vote rejected by the engine.
export function trimForChat(text, maxChars = DEFAULT_MAX_CHAT_CHARS) {
  const raw = String(text || '').trim();
  const limit = Math.max(1, Math.min(Number(maxChars) || DEFAULT_MAX_CHAT_CHARS, ENGINE_BODY_LIMIT));
  if (raw.length <= limit) return raw;

  const window = raw.slice(0, limit);
  // Prefer the last sentence terminator, but only if it leaves a substantial
  // message — cutting a 400-char limit down to 20 chars because that's where
  // the first period fell would lose the actual point.
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentenceEnd >= limit * 0.5) return window.slice(0, sentenceEnd + 1).trim();
  if (/[.!?]$/.test(window.trim())) return window.trim();

  const wordEnd = window.lastIndexOf(' ');
  const cut = wordEnd >= limit * 0.5 ? window.slice(0, wordEnd) : window;
  return `${cut.trim().replace(/[,;:]$/, '')}…`;
}

function maxChatCharsFor(session) {
  return session?._profile?.maxChatChars ?? DEFAULT_MAX_CHAT_CHARS;
}

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
    case 'recruit':
    case 'possess':
    case 'infect':     return { engineType: 'action', variantFrom: null };
    case 'forge':      return { engineType: 'action', variantFrom: null, day: true, forge: true };
    // Faction-wide Heretic attack -> its own engine event (action:submit-faction).
    case 'blood_ritual': return { engineType: 'faction-action' };
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
    return {
      type: clean.asPuppet ? 'chat-as' : 'chat',
      payload: { code: session.conclaveCode, channel: 'public', body: trimForChat(clean.text, maxChatCharsFor(session)) }
    };
  }

  if (clean.kind === 'vote') {
    return { type: clean.asPuppet ? 'vote-as' : 'vote', payload: {
      code: session.conclaveCode,
      targetCode: clean.target || 'skip',
      justification: trimForChat(clean.justification, maxChatCharsFor(session))
    } };
  }

  // night_action
  const verb = clean.verb;
  if (!verb) return null;
  if (verb === 'sleep') return { type: 'sleep', payload: null };
  const intent = verbToIntent(verb, session);
  if (intent.engineType === 'faction-action') {
    if (!clean.target) return null;
    return { type: 'faction-action', payload: { code: session.conclaveCode, targetCode: clean.target } };
  }
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
    payload.body = trimForChat(clean.text || clean.body, maxChatCharsFor(session)) || null;
  }
  return { type: 'action', payload };
}