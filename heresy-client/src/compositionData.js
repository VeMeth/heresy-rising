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
import { DRIFT, ROLE_DRIFT_WEIGHT, SERMON_TARGET, SCALED_COSTS, formatSigned, renderTemplate, scaledCostLabel } from './driftCosts.js';
// hardRules / roleThresholds below are DERIVED from game_data/composition.json
// (the server's authoritative config, read via the @game_data Vite alias —
// see driftCosts.js for why this pattern beats hand-typing the same numbers
// twice) rather than re-typed here, so a threshold change in one place can't
// silently drift out of sync with the other.
import composition from '@game_data/composition.json';

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
    scaledCostKey: 'priest',
    abilityTemplate: 'Each night choose a sermon tier and target. Whisper ({whisperTarget} to target, {whisperCost} self-drift, daily), Hymn ({hymnTarget} to target, {hymnCost} self-drift, 2/game), Litany ({litanyTarget} to target floored at 0, {litanyCost} self-drift, once/game) — self-drift costs scale with table size, cheaper at a big table.'
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
    scaledCostKey: 'heretic-priest',
    abilityTemplate: 'Same UI as Loyalist Priest but effects are inverted: target drift rises instead of falls. False Comfort ({falseComfortCost} self-drift, looks like Whisper to target), Twisted Hymn ({twistedHymnCost} self-drift, target feels \'strengthened in faith\'), Warp Litany ({warpLitanyCost} self-drift, transcendent sermon) — self-drift costs scale with table size, cheaper at a big table. Detection requires drift-delta tracking.'
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
  ['poxwalker', {
    id: 'poxwalker', displayName: 'Poxwalker', faction: 'heretic', tier: 'T3',
    claim: 'Imperial Citizen',
    abilityTemplate: 'Once per game, infect a living non-Heretic for {driftWeight} self-drift. They become Patient Zero and gain +2 drift every night. Anyone whose night action touches Patient Zero — or who is touched by Patient Zero\'s own night action — catches a milder +1 per night on top of their own costs, and keeps carrying it for the rest of the game. Nobody dies of it: a carrier who reaches Black ({blackMin}) sits there, rolling a coin each night to lose their night action. A Chirurgeon\'s protection cleanses whoever it lands on, one player at a time; landing it on Patient Zero stops the source and halts new infections, but everyone already carrying it keeps carrying it.'
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
  if (role?.scaledCostKey) {
    const tierKeyToPlaceholder = tier => tier.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const scaled = SCALED_COSTS[role.scaledCostKey];
    // Alias shape (scaled.curve set) keeps its own tier names in tierKeys;
    // legacy inline shape has no .curve and lists tiers via baseValues.
    const tiers = scaled.curve ? scaled.tierKeys : Object.keys(scaled.baseValues);
    for (const tier of tiers) context[`${tierKeyToPlaceholder(tier)}Cost`] = scaledCostLabel(role.scaledCostKey, tier, playerCount);
  }
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

// Every *_min_player_count numeric entry in composition.json's hardRules
// block (the *_rationale prose entries and non-numeric rules are filtered
// out) — picks up any new threshold (e.g. sanctioned_psyker_min_player_count)
// automatically instead of needing a matching line added here by hand.
export const hardRules = Object.fromEntries(
  Object.entries(composition.hardRules).filter(
    ([key, value]) => key.endsWith('_min_player_count') && typeof value === 'number'
  )
);

// Human-readable labels for the soft-rule thresholds, used by the picker to
// explain *why* a role is gated below a given count. The player-count number
// in each label is generated from hardRules (itself derived from
// composition.json above) via the template functions below, so the label
// can never disagree with the threshold it describes — only the prose
// around the number is hand-kept here.
const roleThresholdText = {
  priest:           { key: 'priest_min_player_count',         label: (min) => `Priest ships at ${min}p+.` },
  'heretic-priest': { key: 'heretic_priest_min_player_count', label: (min) => `Needs a Priest claim and ≥1 other Heretic for cover (${min}p+).` },
  recruiter:        { key: 'recruiter_min_player_count',      label: (min) => `Catalyst carrier required for the conversion win path (${min}p+).` },
  conspirator:      { key: 'conspirator_min_player_count',    label: (min) => `Forgery needs ≥10 living players for density (${min}p+).` },
  animus:           { key: 'animus_min_player_count',         label: (min) => `Possession needs a big enough table for a speculation guess to matter (${min}p+).` },
};

export const roleThresholds = Object.fromEntries(
  Object.entries(roleThresholdText).map(([id, { key, label }]) => {
    const min = hardRules[key];
    return [id, { min, label: label(min) }];
  })
);

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