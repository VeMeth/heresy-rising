export function driftZone(config, value) {
  return config.zones.find(zone => value >= zone.min && value <= zone.max) || config.zones.at(-1);
}

export function intelNoiseRate(driftConfig, rules, drift, weight) {
  const rate = driftZone(driftConfig, drift).noise || 0;
  const { GENTLE_ROLE_DRIFT_WEIGHT, GENTLE_ROLE_NOISE_MULTIPLIER } = rules.interrogation;
  return weight === GENTLE_ROLE_DRIFT_WEIGHT ? rate * GENTLE_ROLE_NOISE_MULTIPLIER : rate;
}

export function noisyResult(rules, truth, rate, random = Math.random) {
  if (random() >= rate) return truth;
  return random() < rules.interrogation.NOISE_UNCLEAR_CHANCE ? 'unclear' : truth === true ? false : truth === false ? true : 'unclear';
}

// Private narrative cue shown to the Murderer when a kill attempt is
// drift-gated (heretic-kit.md v1.5.0 § H1). Green never gates (max Green
// drift 4 + kill cost 15 = 19, under MAX_DRIFT), so it has no cue.
const MURDERER_GATE_CUES = {
  yellow: 'You step toward the target. They see something in your eyes — a hesitation, a wrongness. They turn. You cannot follow.',
  orange: 'The blade is in your hand. The target is in your sight. Your hand is shaking. They notice. They run.',
  red: 'Visions take you. The Warp peels away your intent. You cannot reach the target tonight.',
  black: 'You try. You cannot tell anymore if you are the hunter or the hunted.'
};

export function murdererGateCue(zoneId) {
  return MURDERER_GATE_CUES[zoneId] || MURDERER_GATE_CUES.red;
}

/**
 * Conclave Proximity Siphon (v2.6.0).
 * For each Imperial Citizen, check their Conclave-list neighbors (left + right).
 * For each neighbor who charged drift this night, siphon 30% (floor 1) to the citizen.
 *
 * @param {object[]} playerList - All players in Conclave list order (seat order).
 * @param {Map<string,number>} nightCharges - playerCode -> total drift charge this night.
 * @param {object} config - The proximitySiphon rules block from rules.json.
 * @param {(playerCode:string, delta:number) => void} changeDriftFn - Callback to apply drift.
 */
export function applyProximitySiphon(playerList, nightCharges, config, changeDriftFn) {
  if (!config || config.scope !== 'night_actions_only') return;

  for (let i = 0; i < playerList.length; i++) {
    const player = playerList[i];
    if (player.role_id !== config.role) continue;
    if (!player.alive) continue;

    const neighbors = [playerList[i - 1], playerList[i + 1]].filter(Boolean);
    let totalSiphon = 0;
    for (const neighbor of neighbors) {
      if (!neighbor.alive) continue;
      const charge = nightCharges.get(neighbor.player_code);
      if (!charge || charge <= 0) continue;
      const siphon = Math.max(config.floor, Math.round(config.rate * charge));
      totalSiphon += siphon;
    }

    if (totalSiphon > 0) {
      changeDriftFn(player.player_code, totalSiphon);
    }
  }
}
