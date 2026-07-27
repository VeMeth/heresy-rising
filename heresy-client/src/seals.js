// Operative seals — the per-player identity mark shown in the roster, in chat,
// on night-action targets, and in the lobby.
//
// Three independent channels, so two operatives are never hard to tell apart:
//   tone    an aged-pigment hue from the palette below
//   field   a heraldic division of the plate (solid / bend / fess / pale / barry)
//   initial the first letter of the displayed name
//
// Seeded from the DISPLAYED NAME, never from playerCode or seat. Everyone can
// see every playerCode, including in the lobby, so a seal derived from it would
// stay identical across the lobby -> game transition and hand out the
// codename -> real-name mapping that anonymized mode exists to hide. Keying off
// the shown name means the seal changes exactly when the name does.
//
// Assignment is by sorted position among the current roster rather than by
// hashing the name: with 12 players and 12 tones a hash collides better than
// nine times in ten, whereas an index cannot collide at all.

// Ordered so that adjacent indices are far apart in hue — a 5-player game uses
// only the first five slots, and those should look nothing like each other.
export const SEAL_PALETTE = [
  '#b69a5c', // aged gold
  '#a32a26', // oxblood
  '#5c8a76', // verdigris
  '#7d6a8f', // warp violet
  '#c07840', // ochre
  '#6f7f96', // iron blue
  '#8f9c6a', // moss
  '#8d5a4e', // rust
  '#4f7d8a', // slate teal
  '#8a6b3f', // bronze
  '#9c8b7a', // bone grey
  '#6b4f4a', // dried blood
];

export const SEAL_FIELDS = ['solid', 'bend', 'fess', 'pale', 'barry'];

// WCAG relative luminance, used to pick an ink that stays legible on whichever
// tone the plate landed on rather than hand-maintaining 12 paired values.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const chan = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

const DARK_INK = '#14100a';
const LIGHT_INK = '#f2ece0';

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Whichever ink actually contrasts better, rather than a hand-tuned luminance
// cut-off — the palette can be re-pigmented without re-deriving a threshold.
// Measured against the undiluted tone, which is the lightest part of the plate
// (the field gradients only ever darken from there), so the letter stays
// legible at the plate's worst case rather than on average.
export function inkFor(hex) {
  return contrast(hex, DARK_INK) >= contrast(hex, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}

function initialOf(name) {
  return (String(name || '?').trim()[0] || '?').toUpperCase();
}

/**
 * Build a name -> seal lookup for one game's roster.
 * @param {string[]} names displayed names of the current players
 * @returns {Map<string, {bg:string, ink:string, field:string, initial:string}>}
 */
export function buildSealMap(names) {
  const roster = [...new Set((names || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const map = new Map();
  roster.forEach((name, i) => {
    const bg = SEAL_PALETTE[i % SEAL_PALETTE.length];
    map.set(name, {
      bg,
      ink: inkFor(bg),
      // Cycling the field on a different modulus than the tone means two
      // players who land on similar-looking tones still differ in field.
      field: SEAL_FIELDS[i % SEAL_FIELDS.length],
      initial: initialOf(name),
    });
  });
  return map;
}

// For authors who aren't on the roster — system posts ("The Vox"), or a name
// from scrollback belonging to someone no longer listed. Neutral plate, no tone.
export function fallbackSeal(name) {
  return { bg: '#2a2c25', ink: '#b8b5a7', field: 'solid', initial: initialOf(name) };
}

/** Inline style for a seal element. */
export function sealStyle(seal) {
  return { '--seal': seal.bg, '--seal-ink': seal.ink };
}
