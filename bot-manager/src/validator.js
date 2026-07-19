// Manager-side soft pre-validation. Per spec § "Action Emission Rules": the
// engine is the source of truth, but the manager catches obviously illegal
// actions before hand-off (so we never blow our kill-shot on a self-target,
// never ask L4 to self-investigate, etc.). On `{ok:false}` the manager
// downgrades the action to `pass` and logs.
//
// Signature: `actionValidator(roleId, action, gameState)` returns {ok:boolean,
// reason?:string}. roleId is the bot's current role id (e.g. 'interrogator');
// action is the parsed/normalized action; gameState is a snapshot the session
// builds from the latest engine state (cripple tier, usage counters, etc.).

import { normalizeAction } from './llm/parseAction.js';

const FORBID_SELF_ROLES = new Set(['interrogator', 'novice-psychic', 'arbitrator', 'priest', 'heretic-priest', 'sanctioned-psyker', 'murderer', 'saboteur', 'recruiter']);

const ROLES_VERBS = new Map([
  ['imperial-citizen', { verbs: ['sleep', 'vote', 'pass', 'chat'], tier: null, sermonTiers: null }],
  ['interrogator', { verbs: ['interrogate', 'sleep', 'vote', 'chat', 'pass'], tier: [1, 2, 3], sermonTiers: null }],
  ['chirurgeon', { verbs: ['protect', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null, allowSelf: true }],
  ['novice-psychic', { verbs: ['scan_drift', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['arbitrator', { verbs: ['bodyguard', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['priest', { verbs: ['sermon', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: ['whisper', 'hymn', 'litany'] }],
  ['sanctioned-psyker', { verbs: ['kill', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['murderer', { verbs: ['kill', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['heretic-priest', { verbs: ['sermon', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: ['false-comfort', 'twisted-hymn', 'warp-litany'] }],
  ['conspirator', { verbs: ['forge', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['saboteur', { verbs: ['trap', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }],
  ['recruiter', { verbs: ['recruit', 'sleep', 'vote', 'chat', 'pass'], tier: null, sermonTiers: null }]
]);

const SERMON_USAGE_LIMITS = {
  // Loyalist Priest — derived from data/roles-40k.json frequency:
  // whisper unlimited, hymn 2 per game, litany once per game.
  priest: { whisper: Infinity, hymn: 2, litany: 1 },
  // Heretic-Priest — false-comfort unlimited, twisted-hymn 2-3 (we treat as 3),
  // warp-litany once per game.
  'heretic-priest': { 'false-comfort': Infinity, 'twisted-hymn': 3, 'warp-litany': 1 }
};

export function actionValidator(roleId, action, gameState = {}) {
  const clean = normalizeAction(action);
  if (!clean) return { ok: false, reason: 'malformed action' };
  if (clean.kind === 'pass') return { ok: true };
  if (clean.kind === 'chat') return validateChat(clean, gameState);
  if (clean.kind === 'vote') return validateVote(clean, gameState);
  if (clean.kind === 'night_action') return validateNightAction(roleId, clean, gameState);
  return { ok: false, reason: `unknown action kind: ${clean.kind}` };
}

function validateChat(action, gameState) {
  const phase = gameState.phase;
  if (phase === 'night') return { ok: false, reason: 'public chat is closed at night' };
  if (!action.text || !String(action.text).trim()) return { ok: false, reason: 'empty chat text' };
  if (String(action.text).length > 1000) return { ok: false, reason: 'chat too long (>1000 chars)' };
  return { ok: true };
}

function validateVote(action, gameState) {
  if (gameState.phase !== 'day') return { ok: false, reason: 'voting is closed (not in day phase)' };
  if (gameState.votingEnabled === false) return { ok: false, reason: 'Day 1 voting is closed (Q28)' };
  if (gameState.round === 1) return { ok: false, reason: 'Day 1 has no vote (Q28)' };
  // skip is always valid; an explicit target must be a living player.
  if (action.target && action.target !== 'skip') {
    if (gameState.alivePlayers && !gameState.alivePlayers.includes(action.target)) {
      return { ok: false, reason: 'vote target is not alive / not a known playerCode' };
    }
    if (action.target === gameState.selfCode) return { ok: false, reason: 'cannot vote for yourself' };
  }
  return { ok: true };
}

function validateNightAction(roleId, action, gameState) {
  const role = ROLES_VERBS.get(roleId);
  if (!role) return { ok: false, reason: `unknown role ${roleId}` };
  if (gameState.phase !== 'night') return { ok: false, reason: 'night actions resolve in night phase only' };
  const verb = action.verb;
  if (!role.verbs.includes(verb)) return { ok: false, reason: `role ${roleId} cannot perform ${verb}` };

  // Cripple gate: T2+ blocks night actions. Conspirator (forge is day action)
  // should never reach this branch.
  if ((gameState.crippleTier || 0) >= 2) return { ok: false, reason: `crippled (T2+); manager soft-rejects night action` };

  if (verb === 'sleep') return { ok: true };

  // Self-target guard (chirurgeon explicitly allowed).
  const targetIsSelf = action.target && gameState.selfCode && action.target === gameState.selfCode;
  if (targetIsSelf && FORBID_SELF_ROLES.has(roleId)) return { ok: false, reason: 'self-targeting not allowed for this role' };

  // Verb-specific:
  switch (verb) {
    case 'interrogate': {
      if (!action.target) return { ok: false, reason: 'interrogate requires a target' };
      if (action.tier == null || ![1, 2, 3].includes(Number(action.tier))) return { ok: false, reason: 'tier must be 1, 2, or 3' };
      if (!gameState.alivePlayers || !gameState.alivePlayers.includes(action.target)) return { ok: false, reason: 'target not alive' };
      return { ok: true };
    }
    case 'scan_drift':
    case 'protect':
    case 'bodyguard':
    case 'trap': {
      if (!action.target) return { ok: false, reason: `${verb} requires a target` };
      if (!gameState.alivePlayers || !gameState.alivePlayers.includes(action.target)) return { ok: false, reason: 'target not alive' };
      return { ok: true };
    }
    case 'sermon': {
      if (!action.target) return { ok: false, reason: 'sermon requires a target' };
      if (!role.sermonTiers.includes(action.sermonTier)) return { ok: false, reason: `invalid sermon tier for ${roleId}: ${action.sermonTier}` };
      if (!gameState.alivePlayers || !gameState.alivePlayers.includes(action.target)) return { ok: false, reason: 'target not alive' };
      // Usage caps per spec.
      const limits = SERMON_USAGE_LIMITS[roleId];
      const uses = (gameState.usage && gameState.usage[action.sermonTier]) || 0;
      if (limits && limits[action.sermonTier] !== Infinity && uses >= limits[action.sermonTier]) {
        return { ok: false, reason: `sermon '${action.sermonTier}' limit reached: ${uses}/${limits[action.sermonTier]}` };
      }
      // Warp litany requires target's zone >= Orange (spec). Recruiter requires target Black (spec).
      // Spec test references both — we handle warp-litany here.
      if (roleId === 'heretic-priest' && action.sermonTier === 'warp-litany') {
        if (!action.target) return { ok: false, reason: 'warp-litany requires a target' };
        const minZones = ['orange', 'red', 'black'];
        const tZone = gameState.targetZones && gameState.targetZones[action.target];
        if (tZone && !minZones.includes(tZone)) return { ok: false, reason: `warp-litany requires target >= Orange; current ${tZone}` };
      }
      return { ok: true };
    }
    case 'kill': {
      if (roleId === 'sanctioned-psyker') {
        const uses = (gameState.usage && gameState.usage.kill) || 0;
        if (uses >= 1) return { ok: false, reason: 'sanctioned-psyker kill already used (once per game)' };
      }
      if (!action.target) return { ok: false, reason: 'kill requires a target' };
      if (!gameState.alivePlayers || !gameState.alivePlayers.includes(action.target)) return { ok: false, reason: 'kill target not alive' };
      if (roleId === 'murderer' && gameState.targetsByFaction && gameState.targetsByFaction.heretic?.includes(action.target)) {
        return { ok: false, reason: 'murderer cannot target another Heretic' };
      }
      return { ok: true };
    }
    case 'recruit': {
      if (!action.target) return { ok: false, reason: 'recruit requires a target' };
      if (!gameState.alivePlayers || !gameState.alivePlayers.includes(action.target)) return { ok: false, reason: 'recruit target not alive' };
      if (gameState.targetZones) {
        const tZone = gameState.targetZones[action.target];
        if (tZone && tZone !== 'black') return { ok: false, reason: `recruit requires target at Black; current ${tZone}` };
      }
      return { ok: true };
    }
    case 'forge': {
      // Forge is a day-only action and has its own engine kind.
      // Night-phase validation should reject it via phase gate above; just hand back to engine.
      return { ok: true };
    }
    default: return { ok: false, reason: `verb ${verb} not handled by validator` };
  }
}