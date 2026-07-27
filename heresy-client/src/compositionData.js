// Public role catalogue for the composition screen. Mirrors the subset of
// data/roles-40k.json that is safe and useful to show in the lobby: identity,
// tier, claim and ability text. Ability text is public knowledge (see
// site/.vitepress/roles/*). Forbidden faction assignments / exact roster
// composition for a live game are NOT included here — only the host's own
// custom picks ever reach the server via `game:start`.
//
// Keep in sync with data/roles-40k.json when roles change.
//
// Ability copy is written as abilityTemplate ({placeholder}s), never with a
// drift number typed directly into the prose, and rendered once below via
// driftCosts.js — see that file for why this is a second, hand-kept-in-sync
// copy of the server's numbers rather than one shared source.
import { DRIFT, ROLE_DRIFT_WEIGHT, SERMON_TARGET, formatSigned, renderTemplate, scaledCostLabel } from './driftCosts.js';

export const validRoles = new Map([
  ['imperial-citizen', {
    id: 'imperial-citizen', displayName: 'Imperial Citizen', faction: 'loyalist', tier: 'T0',
    claim: 'Imperial Citizen (self)',
    abilityTemplate: 'You have no night power. Discuss, vote, read the table, and survive on wit. Sleep ({sleepRecovery} drift) by default.'
  }],
  ['interrogator', {
    id: 'interrogator', displayName: 'Interrogator', faction: 'loyalist', tier: 'T2',
    claim: 'Interrogator (self)',
    scaledCostKey: 'interrogator',
    abilityTemplate: 'Each night interrogate one player at chosen intensity: T1 Soft ({t1Cost} drift), T2 Standard ({t2Cost} drift, confirms alignment hint), T3 Brutal ({t3Cost} drift, confirms Heretic/Loyalist) — costs scale with table size, cheaper at a big table. T2+ vs Orange+ target auto-kills on sight.'
  }],
  ['chirurgeon', {
    id: 'chirurgeon', displayName: 'Chirurgeon', faction: 'loyalist', tier: 'T1',
    claim: 'Chirurgeon (self)',
    abilityTemplate: 'Each night protect one player from a night kill. You do not learn whether your protection fired.'
  }],
  ['novice-psychic', {
    id: 'novice-psychic', displayName: 'Novice-Psychic', faction: 'loyalist', tier: 'T1',
    claim: 'Novice-Psychic (self)',
    abilityTemplate: 'Each night receive a qualitative drift hint about one target. Reads drift, not alignment.'
  }],
  ['arbitrator', {
    id: 'arbitrator', displayName: 'Arbitrator', faction: 'loyalist', tier: 'T1',
    claim: 'Arbitrator (self)',
    abilityTemplate: 'Each night bodyguard-proxy one player: take the hit for them if attacked. You survive; both learn the proxy fired the next day.'
  }],
  ['priest', {
    id: 'priest', displayName: 'Priest (Loyalist)', faction: 'loyalist', tier: 'T0_special',
    claim: 'Priest (self)',
    abilityTemplate: 'Each night choose a sermon tier and target. Whisper ({whisperTarget} daily), Hymn ({hymnTarget}, 2/game), Litany ({litanyTarget}, once/game) to reduce a target\'s drift.'
  }],
  ['sanctioned-psyker', {
    id: 'sanctioned-psyker', displayName: 'Sanctioned Psyker', faction: 'loyalist', tier: 'T2',
    claim: 'Imperial Citizen',
    abilityTemplate: 'One-shot warp-kill: once per game, fire a kill on any player, any night, any faction. {driftWeight} self-drift on fire (lands you at Red — a T2+ Interrogator scan executes you on sight). No role marker; looks identical to Murderer from the table\'s perspective.'
  }],
  ['murderer', {
    id: 'murderer', displayName: 'Murderer', faction: 'heretic', tier: 'T2',
    claim: 'Imperial Citizen',
    abilityTemplate: 'Each night kill one player. Traditional hidden-killer role. Full Heretic chat access; sees other Heretics\' plans.'
  }],
  ['heretic-priest', {
    id: 'heretic-priest', displayName: 'Heretic Priest', faction: 'heretic', tier: 'T0_special',
    claim: 'Priest (claims-matching with Loyalist Priest)',
    abilityTemplate: 'Same UI as Loyalist Priest but effects are inverted: target drift rises instead of falls. Detection requires drift-delta tracking.'
  }],
  ['conspirator', {
    id: 'conspirator', displayName: 'Conspirator', faction: 'heretic', tier: 'T1',
    claim: 'Imperial Citizen',
    abilityTemplate: 'Once per day post a message in day chat attributed to another player. The forged sender must decide whether to publicly correct it or let it stand.'
  }],
  ['saboteur', {
    id: 'saboteur', displayName: 'Saboteur', faction: 'heretic', tier: 'T2',
    claim: 'Imperial Citizen',
    abilityTemplate: 'Each night booby-trap one player. Any night action performed on them gives the actor {trapDrift} drift and yields no result; you get a private notification.'
  }],
  ['recruiter', {
    id: 'recruiter', displayName: 'Recruiter', faction: 'heretic', tier: 'T3',
    claim: 'Imperial Citizen',
    abilityTemplate: 'Each night target one player at Black zone (drift {blackMin}) to flip them to Heretic — silent and immediate. Failure if the target is not at Black.'
  }],
  ['animus', {
    id: 'animus', displayName: 'Animus', faction: 'heretic', tier: 'T3',
    claim: 'Imperial Citizen',
    abilityTemplate: 'One-shot speculation: target a non-Heretic you believe is in Red drift. If right, you possess them for a day (speak in their name, their vote is voided, their night is skipped) — the body detonates at day\'s end, revealing full role and faction. Wrong guess just wastes the attempt.'
  }],
]);

// Shared cost placeholders every role's abilityTemplate may reference,
// keyed off nothing but the role's own id + the driftCosts.js constants.
// playerCount omitted → scaled-cost roles get a cheapest–priciest range
// across every valid table size (5-12p); given → that lobby's exact cost.
function costContext(id, playerCount) {
  const context = {
    sleepRecovery: formatSigned(DRIFT.SLEEP_RECOVERY),
    trapDrift: formatSigned(DRIFT.TRAP_DRIFT),
    blackMin: DRIFT.ZONES.black[0],
    driftWeight: formatSigned(ROLE_DRIFT_WEIGHT[id] ?? 0),
    whisperTarget: formatSigned(SERMON_TARGET.whisper),
    hymnTarget: formatSigned(SERMON_TARGET.hymn),
    litanyTarget: formatSigned(SERMON_TARGET.litany),
  };
  const role = validRoles.get(id);
  if (role?.scaledCostKey) for (const tier of ['t1', 't2', 't3']) context[`${tier}Cost`] = scaledCostLabel(role.scaledCostKey, tier, playerCount);
  return context;
}

// Rendered once, here, from each entry's abilityTemplate — never a hand-typed
// digit in the prose. Every downstream consumer (LobbyView's composition
// picker, AdminView, SimResultsPanel) keeps reading a plain `.ability`
// string exactly as before; nothing downstream needs to know rendering
// happens at all.
for (const [id, role] of validRoles) {
  role.ability = renderTemplate(role.abilityTemplate, costContext(id));
}

// Exact per-tier cost for a specific lobby's target player count. LobbyView's
// composition "More" expander calls this (instead of reading `role.ability`
// directly) once the host has picked a roster size, so a scaled-cost role
// like Interrogator shows THIS lobby's number instead of the static range —
// mirrors the server's roleForDisplay()/renderAbility(role, drift, {playerCount}).
export function roleAbilityForLobby(role, playerCount) {
  if (!role.scaledCostKey) return role.ability;
  return renderTemplate(role.abilityTemplate, costContext(role.id, playerCount));
}

export const hardRules = {
  priest_min_player_count: 5,
  heretic_priest_min_player_count: 6,
  recruiter_min_player_count: 8,
  conspirator_min_player_count: 11,
  animus_min_player_count: 8,
};

// Human-readable labels for the soft-rule thresholds, used by the picker to
// explain *why* a role is gated below a given count.
export const roleThresholds = {
  priest:           { min: 5,  label: 'Priest ships at 5p+.' },
  'heretic-priest': { min: 6,  label: 'Needs a Priest claim and ≥1 other Heretic for cover (6p+).' },
  recruiter:        { min: 8,  label: 'Catalyst carrier required for the conversion win path (8p+).' },
  conspirator:      { min: 11, label: 'Forgery needs ≥10 living players for density (11p+).' },
  animus:           { min: 8,  label: 'Possession needs a big enough table for a speculation guess to matter (8p+).' },
};

export const presetFlavor = {
  5:  'Interrogation cell — tight, lethal, no hiding',
  6:  'War council — Heretic Priest joins the feast',
  7:  'Crusade squad — one extra pair of eyes',
  8:  'Strike team — Saboteur sets traps in the dark',
  9:  'StrikeForce Omega — full spectrum coverage',
  10: 'Inquisitorial cadre — Recruiter enters the field',
  11: 'Conclave ascendant — Conspirator forges the record',
  12: 'Full conclave — maximum chaos, maximum cover',
};