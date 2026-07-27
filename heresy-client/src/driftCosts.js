// Client-side drift cost constants — values live in game_data/driftCosts.json for
// easy balance editing, imported here and re-exported alongside rendering
// functions.
//
// This is a client-side copy of selector numbers from data/roles-40k.json and
// data/drift.json (the server's source of truth). The client has no shared-code
// channel with the server package (two separate npm packages), so edits to
// server files must be mirrored here; nothing enforces that automatically.
// Putting the values in a separate JSON makes that sync check a simple diff.
//
// This file exists so that compositionData.js and glossary.js — the two
// places on the client that describe ability costs in prose — pull every
// number from ONE place each, rather than each hand-typing its own literal
// digits. When drift costs are calculated instead of fixed, whatever
// replaces this static object is what changes; the templates that consume
// it do not.

import values from '../../game_data/driftCosts.json';

export const DRIFT = values.DRIFT;
export const ROLE_DRIFT_WEIGHT = values.ROLE_DRIFT_WEIGHT;
export const SERMON_TARGET = values.SERMON_TARGET;
export const SCALED_COSTS = values.SCALED_COSTS;

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
