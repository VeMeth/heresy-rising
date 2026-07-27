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
