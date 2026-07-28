// Client-side drift cost constants — DERIVED directly from the server's own
// config files (game_data/drift.json, game_data/roles-40k.json) via a Vite
// alias (@game_data → ../game_data, see vite.config.js). The client has no
// shared-code channel with the server package (two separate npm packages),
// but both now read the SAME json off disk, so there is no manual mirror to
// keep in sync — edit the server config and the client picks it up on next
// build/reload.
//
// This file exists so that compositionData.js and glossary.js — the two
// places on the client that describe ability costs in prose — pull every
// number from ONE place each, rather than each hand-typing its own literal
// digits. When drift costs are calculated instead of fixed, whatever
// replaces this static object is what changes; the templates that consume
// it do not.

import drift from '@game_data/drift.json';
import rolesFile from '@game_data/roles-40k.json';

// Zone order, derived (not hand-listed) from each zone's `min` so a new zone
// added to drift.json's `zones` array is picked up automatically instead of
// being a silent no-op on the client.
export const DRIFT_ZONE_ORDER = [...drift.zones].sort((a, b) => a.min - b.min).map((z) => z.id);

export const DRIFT = {
  MAX: drift.MAX_DRIFT,
  SLEEP_RECOVERY: drift.NIGHTLY_SLEEP_RECOVERY,
  TRAP_DRIFT: drift.TRAP_DRIFT,
  ZONES: Object.fromEntries(drift.zones.map((z) => [z.id, [z.min, z.max]]))
};

export const ROLE_DRIFT_WEIGHT = Object.fromEntries(
  rolesFile.roles.map((role) => [role.id, role.driftWeight])
);

export const SERMON_TARGET = {
  whisper: drift.sermons.whisper.target,
  hymn: drift.sermons.hymn.target,
  litany: drift.sermons.litany.target
};

// scaledCosts, minus the `_schema` documentation key and `_curves` (curves
// are shared balance tables, not roles — scaledCostLabel/compositionData
// iterate this as "here are the scaled-cost roles" and would otherwise trip
// over both). Curve data itself is still needed to resolve an alias role's
// cost, so it's kept reachable via the un-filtered drift.scaledCosts below.
export const SCALED_COSTS = Object.fromEntries(
  Object.entries(drift.scaledCosts).filter(([key]) => key !== '_schema' && key !== '_curves')
);

const RAW_SCALED_COSTS = drift.scaledCosts;

export function scaledCostFormula(base, floor, players) {
  return Math.round(Math.max(floor, base / players));
}

// Shared resolution logic for a "block" — an object shaped like
// {baseValues, floors, perPlayerCount} — used for both the legacy inline
// role shape and (after mapping tierKey through the alias) a shared curve.
// Mirrors the server's resolveFromBlock in mechanics/scaledCosts.js.
function resolveFromBlock(block, tierKey, playerCount) {
  const known = block.perPlayerCount[playerCount];
  if (known && known[tierKey] !== undefined) return known[tierKey];
  return scaledCostFormula(block.baseValues[tierKey], block.floors[tierKey], playerCount);
}

// The block actually holding baseValues/floors/perPlayerCount for a role:
// itself for the legacy inline shape, or the curve it aliases.
function blockFor(roleKey, role) {
  if (!role.curve) return role;
  const curve = RAW_SCALED_COSTS._curves?.[role.curve];
  if (!curve) throw new Error(`driftCosts: role "${roleKey}" references unknown curve "${role.curve}"`);
  return curve;
}

// Raw numeric cost for one exact table size — mirrors the server's
// resolveScaledCost(scaledCosts, roleKey, tierKey, playerCount).
export function resolveScaledCost(roleKey, tierKey, playerCount) {
  const role = SCALED_COSTS[roleKey];
  if (!role) throw new Error(`driftCosts: no scaledCosts config for role "${roleKey}"`);
  if (role.curve) {
    const curve = blockFor(roleKey, role);
    const idx = role.tierKeys?.indexOf(tierKey);
    if (idx === undefined || idx === -1) throw new Error(`driftCosts: role "${roleKey}" has no tier "${tierKey}"`);
    return resolveFromBlock(curve, Object.keys(curve.baseValues)[idx], playerCount);
  }
  return resolveFromBlock(role, tierKey, playerCount);
}

// Formatted for prose: an exact "+N drift" when playerCount is known (a live
// lobby whose target roster size is set), or a "+cheapest–+priciest" range
// across every valid table size (5-12p) for static/catalog display with no
// specific lobby in scope — mirrors the server's buildCostContext branch.
export function scaledCostLabel(roleKey, tierKey, playerCount) {
  if (playerCount !== undefined) return formatSigned(resolveScaledCost(roleKey, tierKey, playerCount));
  const role = SCALED_COSTS[roleKey];
  if (!role) throw new Error(`driftCosts: no scaledCosts config for role "${roleKey}"`);
  const block = blockFor(roleKey, role);
  const counts = Object.keys(block.perPlayerCount).map(Number);
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
