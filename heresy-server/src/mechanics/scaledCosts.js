// Player-scaled ability costs (dispatch Q31 — projects/heresy-rising/dispatches/
// 2026-07-27-q31-interrogator-cost.md). A scaled cost is cost = round(max(floor,
// base / players)) — cheap at a big table, expensive at a small one, never
// below its floor. Reusable across future roles: each gets one config block
// under drift.json's `scaledCosts`, keyed by role, with per-tier baseValues
// and floors. No new resolver code is needed to add a role — see
// heresyGameManager.js's generic use of `role.scaledCostKey`.
//
// perPlayerCount in drift.json is a precomputed cache for the engine's hot
// path; validateScaledCosts() below regenerates it from baseValues+floors+
// the formula and must match exactly, so drift.json's numbers can be hand-
// edited (adjust baseValues/floors, they're the actual source of truth) and
// re-validated rather than silently drifting out of sync.

export function scaledCostFormula(base, floor, players) {
  return Math.round(Math.max(floor, base / players));
}

export function resolveScaledCost(scaledCosts, roleKey, tierKey, playerCount) {
  const role = scaledCosts?.[roleKey];
  if (!role) throw new Error(`scaledCosts: no config for role "${roleKey}"`);
  const base = role.baseValues?.[tierKey];
  const floor = role.floors?.[tierKey];
  if (base === undefined || floor === undefined) throw new Error(`scaledCosts: role "${roleKey}" has no tier "${tierKey}"`);
  const known = role.perPlayerCount?.[String(playerCount)];
  if (known && known[tierKey] !== undefined) return known[tierKey];
  return scaledCostFormula(base, floor, playerCount);
}

// Throws with a precise mismatch message if any precomputed perPlayerCount
// cell doesn't match what baseValues/floors/the formula would produce —
// run as a test against the live data/drift.json, not at server boot.
export function validateScaledCosts(scaledCosts) {
  for (const [roleKey, role] of Object.entries(scaledCosts)) {
    if (roleKey === '_schema') continue;
    for (const [playerCount, values] of Object.entries(role.perPlayerCount || {})) {
      for (const [tierKey, expected] of Object.entries(values)) {
        const computed = scaledCostFormula(role.baseValues[tierKey], role.floors[tierKey], Number(playerCount));
        if (computed !== expected) {
          throw new Error(`scaledCosts: ${roleKey}.${tierKey} at ${playerCount}p — drift.json has ${expected} but baseValues/floors/formula gives ${computed}`);
        }
      }
    }
  }
}
