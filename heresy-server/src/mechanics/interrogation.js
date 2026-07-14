export function effectiveCrippleTier(player, round) {
  if (player.cripple_tier >= 2) return player.cripple_tier;
  return player.cripple_tier === 1 && player.tier1_until_round >= round ? 1 : 0;
}

const ZONE_UPGRADE = { green: 0, yellow: 1, orange: 2, red: 2, black: 2 };

export function getZoneUpgrade(zoneId) {
  return ZONE_UPGRADE[zoneId] ?? 0;
}

export function getEffectiveScanTier(chosenIntensity, targetZoneId) {
  return Math.min(3, chosenIntensity + getZoneUpgrade(targetZoneId));
}

export function isExecuteOnSight(chosenIntensity, targetZoneId) {
  return chosenIntensity >= 2 && getZoneUpgrade(targetZoneId) >= 2;
}
