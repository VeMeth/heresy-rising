// TODO(heresy-spec): Repeat-target escalation is a non-canonical default: T1, then T2, then T3; changing target resets to T1.
export function nextInterrogationTier(previousTarget, previousTier, target) {
  return previousTarget === target ? Math.min(3, Number(previousTier || 0) + 1) : 1;
}

// TODO(heresy-spec): T1 recovers after one full round without re-interrogation; T2 and T3 are permanent.
export function effectiveCrippleTier(player, round) {
  if (player.cripple_tier >= 2) return player.cripple_tier;
  return player.cripple_tier === 1 && player.tier1_until_round >= round ? 1 : 0;
}
