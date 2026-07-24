export function effectiveCrippleTier(player, round) {
  if (player.cripple_tier >= 2) return player.cripple_tier;
  return player.cripple_tier === 1 && player.tier1_until_round >= round ? 1 : 0;
}

// Player-facing flavor for cripple_tier — used in place of the raw "Tier N"
// in system/torture-chamber text, which reads as a game-mechanic leak rather
// than in-fiction consequence.
const CRIPPLE_SEVERITY = {
  1: 'wounded, but still breathing',
  2: 'crippled, barely able to stand',
  3: 'shattered beyond recovery'
};

export function crippleSeverityLabel(tier) {
  return CRIPPLE_SEVERITY[tier] || `wounded (tier ${tier})`;
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
