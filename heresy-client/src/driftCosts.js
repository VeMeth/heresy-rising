// Client-side counterpart to heresy-server/src/mechanics/abilityText.js.
//
// The client has no shared-code channel with the server package (two
// separate npm packages, no shared workspace), so these numbers are a SECOND
// copy of the same constants — cross-checked against data/drift.json and
// each role's driftWeight/sermonTiers in data/roles-40k.json as of this
// writing, not against the server's rendered prose. If either server file
// changes, this file must be updated to match; nothing enforces that
// automatically. A true single source would mean the client fetching this
// from the server at runtime (a public, non-admin "role reference" endpoint)
// instead of bundling its own copy — not done here, since it changes the
// composition screen from an instant, network-free display into one with a
// round trip, which is a bigger tradeoff than "don't hardcode costs in
// prose" asked for.
//
// This file exists so that compositionData.js and glossary.js — the two
// places on the client that describe ability costs in prose — pull every
// number from ONE place each, rather than each hand-typing its own literal
// digits. When drift costs are calculated instead of fixed, whatever
// replaces this static object is what changes; the templates that consume
// it do not.

export const DRIFT = {
  MAX: 20,
  SLEEP_RECOVERY: -1,
  TRAP_DRIFT: 5,
  ZONES: {
    green: [0, 4],
    yellow: [5, 9],
    orange: [10, 14],
    red: [15, 19],
    black: [20, 20],
  },
};

// driftWeight per role, mirroring data/roles-40k.json. Only the roles whose
// client-facing copy (compositionData.js) or a glossary tooltip actually
// states a number need an entry here — the rest have no cost digit to
// template in the first place.
export const ROLE_DRIFT_WEIGHT = {
  interrogator: 2,
  'sanctioned-psyker': 15,
  murderer: 15,
  saboteur: 2,
  recruiter: 3,
  animus: 3,
};

// Priest's sermonTiers.<tier>.targetEffect, mirroring data/roles-40k.json.
export const SERMON_TARGET = {
  whisper: -2,
  hymn: -5,
  litany: -10,
};

// Q31 (dispatches/2026-07-27-q31-interrogator-cost.md): Interrogator's T1/T2/T3
// self-cost now scales with table size instead of ROLE_DRIFT_WEIGHT's flat
// number above (which is stale for this role — kept only because nothing
// else references it). Mirrors data/drift.json's scaledCosts.interrogator.
export const SCALED_COSTS = {
  interrogator: {
    baseValues: { t1: 10, t2: 20, t3: 50 },
    floors: { t1: 1, t2: 2, t3: 3 },
    perPlayerCount: {
      5: { t1: 2, t2: 4, t3: 10 },
      6: { t1: 2, t2: 3, t3: 8 },
      7: { t1: 1, t2: 3, t3: 7 },
      8: { t1: 1, t2: 3, t3: 6 },
      9: { t1: 1, t2: 2, t3: 6 },
      10: { t1: 1, t2: 2, t3: 5 },
      11: { t1: 1, t2: 2, t3: 5 },
      12: { t1: 1, t2: 2, t3: 4 },
    },
  },
};

export function scaledCostFormula(base, floor, players) {
  return Math.round(Math.max(floor, base / players));
}

// Raw numeric cost for one exact table size — mirrors the server's
// resolveScaledCost(scaledCosts, roleKey, tierKey, playerCount).
export function resolveScaledCost(roleKey, tierKey, playerCount) {
  const role = SCALED_COSTS[roleKey];
  if (!role) throw new Error(`driftCosts: no scaledCosts config for role "${roleKey}"`);
  const known = role.perPlayerCount[playerCount];
  if (known) return known[tierKey];
  return scaledCostFormula(role.baseValues[tierKey], role.floors[tierKey], playerCount);
}

// Formatted for prose: an exact "+N drift" when playerCount is known (a live
// lobby whose target roster size is set), or a "+cheapest–+priciest" range
// across every valid table size (5-12p) for static/catalog display with no
// specific lobby in scope — mirrors the server's buildCostContext branch.
export function scaledCostLabel(roleKey, tierKey, playerCount) {
  if (playerCount !== undefined) return formatSigned(resolveScaledCost(roleKey, tierKey, playerCount));
  const counts = Object.keys(SCALED_COSTS[roleKey].perPlayerCount).map(Number);
  const cheapest = resolveScaledCost(roleKey, tierKey, Math.max(...counts));
  const priciest = resolveScaledCost(roleKey, tierKey, Math.min(...counts));
  return cheapest === priciest ? formatSigned(cheapest) : `${formatSigned(cheapest)}–${formatSigned(priciest)}`;
}

export function formatSigned(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`; // U+2212, matching the game's existing minus glyph
  return '0';
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function renderTemplate(template, values) {
  return template.replace(PLACEHOLDER, (match, key) => {
    if (!(key in values)) throw new Error(`driftCosts: template references unknown placeholder {${key}}`);
    return String(values[key]);
  });
}
