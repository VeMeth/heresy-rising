// PERMANENT_AT_TIER, not JUSTIFY_VOTES_AT_TIER: this threshold is "damage
// stops expiring", which happens to share the value 2 with the justify-your-
// vote rule but is a different mechanic. Binding both to one key would make
// raising the justify threshold silently turn tier-2 damage temporary.
export function effectiveCrippleTier(rules, player, round) {
  if (player.cripple_tier >= rules.cripple.PERMANENT_AT_TIER) return player.cripple_tier;
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

export function getZoneUpgrade(rules, zoneId) {
  return rules.interrogation.zoneTierUpgrade[zoneId] ?? 0;
}

export function getEffectiveScanTier(rules, chosenIntensity, targetZoneId) {
  return Math.min(rules.interrogation.MAX_SCAN_TIER, chosenIntensity + getZoneUpgrade(rules, targetZoneId));
}

export function isExecuteOnSight(rules, chosenIntensity, targetZoneId) {
  return chosenIntensity >= rules.interrogation.EXECUTE_ON_SIGHT_MIN_INTENSITY && getZoneUpgrade(rules, targetZoneId) >= rules.interrogation.EXECUTE_ON_SIGHT_MIN_ZONE_UPGRADE;
}
