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
