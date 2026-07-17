export const validRoles = new Map([
  ['imperial-citizen', { id: 'imperial-citizen', displayName: 'Imperial Citizen', faction: 'loyalist' }],
  ['interrogator', { id: 'interrogator', displayName: 'Interrogator', faction: 'loyalist' }],
  ['chirurgeon', { id: 'chirurgeon', displayName: 'Chirurgeon', faction: 'loyalist' }],
  ['novice-psychic', { id: 'novice-psychic', displayName: 'Novice-Psychic', faction: 'loyalist' }],
  ['arbitrator', { id: 'arbitrator', displayName: 'Arbitrator', faction: 'loyalist' }],
  ['priest', { id: 'priest', displayName: 'Priest', faction: 'loyalist' }],
  ['murderer', { id: 'murderer', displayName: 'Murderer', faction: 'heretic' }],
  ['heretic-priest', { id: 'heretic-priest', displayName: 'Heretic Priest', faction: 'heretic' }],
  ['conspirator', { id: 'conspirator', displayName: 'Conspirator', faction: 'heretic' }],
  ['saboteur', { id: 'saboteur', displayName: 'Saboteur', faction: 'heretic' }],
  ['recruiter', { id: 'recruiter', displayName: 'Recruiter', faction: 'heretic' }],
]);

export const hardRules = {
  priest_min_player_count: 5,
  heretic_priest_min_player_count: 6,
  recruiter_min_player_count: 8,
  conspirator_min_player_count: 11,
};

export const presetFlavor = {
  5: 'Interrogation cell — tight, lethal, no hiding',
  6: 'War council — Heretic Priest joins the feast',
  7: 'Crusade squad — one extra pair of eyes',
  8: 'Strike team — Saboteur sets traps in the dark',
  9: 'StrikeForce Omega — full spectrum coverage',
  10: 'Inquisitorial cadre — Recruiter enters the field',
  11: 'Conclave ascendant — Conspirator forges the record',
  12: 'Full conclave — maximum chaos, maximum cover',
};
