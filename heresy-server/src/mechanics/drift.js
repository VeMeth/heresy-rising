export function driftZone(config, value) {
  return config.zones.find(zone => value >= zone.min && value <= zone.max) || config.zones.at(-1);
}

export function intelNoiseRate(config, drift, weight) {
  const rate = driftZone(config, drift).noise || 0;
  return weight === 1 ? rate / 2 : rate;
}

export function noisyResult(truth, rate, random = Math.random) {
  if (random() >= rate) return truth;
  return random() < 0.5 ? 'unclear' : truth === true ? false : truth === false ? true : 'unclear';
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
