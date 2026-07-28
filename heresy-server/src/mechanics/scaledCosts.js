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

// Shared resolution logic for a "block" — an object shaped like
// {baseValues, floors, perPlayerCount} — used by both the legacy inline
// role shape and (after mapping tierKey through the alias) the shared
// curve shape. `roleKey` is only used for the error message.
function resolveFromBlock(block, roleKey, tierKey, playerCount) {
  const base = block.baseValues?.[tierKey];
  const floor = block.floors?.[tierKey];
  if (base === undefined || floor === undefined) throw new Error(`scaledCosts: role "${roleKey}" has no tier "${tierKey}"`);
  const known = block.perPlayerCount?.[String(playerCount)];
  if (known && known[tierKey] !== undefined) return known[tierKey];
  return scaledCostFormula(base, floor, playerCount);
}

export function resolveScaledCost(scaledCosts, roleKey, tierKey, playerCount) {
  const role = scaledCosts?.[roleKey];
  if (!role) throw new Error(`scaledCosts: no config for role "${roleKey}"`);

  if (role.curve) {
    const curve = scaledCosts._curves?.[role.curve];
    if (!curve) throw new Error(`scaledCosts: role "${roleKey}" references unknown curve "${role.curve}"`);
    const idx = role.tierKeys?.indexOf(tierKey);
    if (idx === undefined || idx === -1) throw new Error(`scaledCosts: role "${roleKey}" has no tier "${tierKey}"`);
    const curveTierKey = Object.keys(curve.baseValues)[idx];
    return resolveFromBlock(curve, roleKey, curveTierKey, playerCount);
  }

  return resolveFromBlock(role, roleKey, tierKey, playerCount);
}

// Throws with a precise mismatch message if any precomputed perPlayerCount
// cell doesn't match what baseValues/floors/the formula would produce —
// run as a test against the live data/drift.json, not at server boot.
function validateBlockCells(blockKey, block) {
  for (const [playerCount, values] of Object.entries(block.perPlayerCount || {})) {
    for (const [tierKey, expected] of Object.entries(values)) {
      const computed = scaledCostFormula(block.baseValues[tierKey], block.floors[tierKey], Number(playerCount));
      if (computed !== expected) {
        throw new Error(`scaledCosts: ${blockKey}.${tierKey} at ${playerCount}p — drift.json has ${expected} but baseValues/floors/formula gives ${computed}`);
      }
    }
  }
}

export function validateScaledCosts(scaledCosts) {
  for (const [curveKey, curve] of Object.entries(scaledCosts._curves || {})) {
    validateBlockCells(curveKey, curve);
  }

  for (const [roleKey, role] of Object.entries(scaledCosts)) {
    if (roleKey === '_schema' || roleKey === '_curves') continue;

    if (role.curve) {
      const curve = scaledCosts._curves?.[role.curve];
      if (!curve) throw new Error(`scaledCosts: role "${roleKey}" references unknown curve "${role.curve}"`);
      const tierCount = Object.keys(curve.baseValues).length;
      if (!Array.isArray(role.tierKeys) || role.tierKeys.length !== tierCount) {
        throw new Error(`scaledCosts: role "${roleKey}" has ${Array.isArray(role.tierKeys) ? role.tierKeys.length : 'no'} tierKeys but curve "${role.curve}" has ${tierCount} tiers`);
      }
      continue;
    }

    validateBlockCells(roleKey, role);
  }
}
