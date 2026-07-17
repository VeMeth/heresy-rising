// Public role catalogue for the composition screen. Mirrors the subset of
// data/roles-40k.json that is safe and useful to show in the lobby: identity,
// tier, claim and ability text. Ability text is public knowledge (see
// site/.vitepress/roles/*). Forbidden faction assignments / exact roster
// composition for a live game are NOT included here — only the host's own
// custom picks ever reach the server via `game:start`.
//
// Keep in sync with data/roles-40k.json when roles change.

export const validRoles = new Map([
  ['imperial-citizen', {
    id: 'imperial-citizen', displayName: 'Imperial Citizen', faction: 'loyalist', tier: 'T0',
    claim: 'Imperial Citizen (self)',
    ability: 'You have no night power. Discuss, vote, read the table, and survive on wit. Sleep (−1 drift) by default.'
  }],
  ['interrogator', {
    id: 'interrogator', displayName: 'Interrogator', faction: 'loyalist', tier: 'T2',
    claim: 'Interrogator (self)',
    ability: 'Each night interrogate one player at chosen intensity. Standard T2 confirms alignment hint; Brutal T3 confirms Heretic/Loyalist. T2+ vs Orange+ target auto-kills on sight.'
  }],
  ['chirurgeon', {
    id: 'chirurgeon', displayName: 'Chirurgeon', faction: 'loyalist', tier: 'T1',
    claim: 'Chirurgeon (self)',
    ability: 'Each night protect one player from a night kill. You do not learn whether your protection fired.'
  }],
  ['novice-psychic', {
    id: 'novice-psychic', displayName: 'Novice-Psychic', faction: 'loyalist', tier: 'T1',
    claim: 'Novice-Psychic (self)',
    ability: 'Each night receive a qualitative drift hint about one target. Reads drift, not alignment.'
  }],
  ['arbitrator', {
    id: 'arbitrator', displayName: 'Arbitrator', faction: 'loyalist', tier: 'T1',
    claim: 'Arbitrator (self)',
    ability: 'Each night bodyguard-proxy one player: take the hit for them if attacked. You survive; both learn the proxy fired the next day.'
  }],
  ['priest', {
    id: 'priest', displayName: 'Priest (Loyalist)', faction: 'loyalist', tier: 'T0_special',
    claim: 'Priest (self)',
    ability: 'Each night choose a sermon tier and target. Whisper (−2 daily), Hymn (−5, 2/game), Litany (−10, once/game) to reduce a target\'s drift.'
  }],
  ['murderer', {
    id: 'murderer', displayName: 'Murderer', faction: 'heretic', tier: 'T2',
    claim: 'Imperial Citizen',
    ability: 'Each night kill one player. Traditional hidden-killer role. Full Heretic chat access; sees other Heretics\' plans.'
  }],
  ['heretic-priest', {
    id: 'heretic-priest', displayName: 'Heretic Priest', faction: 'heretic', tier: 'T0_special',
    claim: 'Priest (claims-matching with Loyalist Priest)',
    ability: 'Same UI as Loyalist Priest but effects are inverted: target drift rises instead of falls. Detection requires drift-delta tracking.'
  }],
  ['conspirator', {
    id: 'conspirator', displayName: 'Conspirator', faction: 'heretic', tier: 'T1',
    claim: 'Imperial Citizen',
    ability: 'Once per day post a message in day chat attributed to another player. The forged sender must decide whether to publicly correct it or let it stand.'
  }],
  ['saboteur', {
    id: 'saboteur', displayName: 'Saboteur', faction: 'heretic', tier: 'T2',
    claim: 'Imperial Citizen',
    ability: 'Each night booby-trap one player. Any night action performed on them gives the actor +5 drift and yields no result; you get a private notification.'
  }],
  ['recruiter', {
    id: 'recruiter', displayName: 'Recruiter', faction: 'heretic', tier: 'T3',
    claim: 'Imperial Citizen',
    ability: 'Each night target one player at Black zone (drift 20) to flip them to Heretic — silent and immediate. Failure if the target is not at Black.'
  }],
]);

export const hardRules = {
  priest_min_player_count: 5,
  heretic_priest_min_player_count: 6,
  recruiter_min_player_count: 8,
  conspirator_min_player_count: 11,
};

// Human-readable labels for the soft-rule thresholds, used by the picker to
// explain *why* a role is gated below a given count.
export const roleThresholds = {
  priest:           { min: 5,  label: 'Priest ships at 5p+.' },
  'heretic-priest': { min: 6,  label: 'Needs a Priest claim and ≥1 other Heretic for cover (6p+).' },
  recruiter:        { min: 8,  label: 'Catalyst carrier required for the conversion win path (8p+).' },
  conspirator:      { min: 11, label: 'Forgery needs ≥10 living players for density (11p+).' },
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