// Operative seals — the per-player identity mark shown in the roster, in chat,
// on night-action targets, and in the lobby.
//
// Three player-selectable styles (src/settings.js persists the choice):
//   ordinary       monochrome gold plate + a heraldic ordinary, two-letter mark
//   coloured       12-tone palette + heraldic field, single-initial mark
//   coloured-mono  identical plate to 'coloured', two-letter mark
//
// For the coloured styles, three independent channels mean two operatives are
// never hard to tell apart:
//   tone    an aged-pigment hue from the palette below
//   field   a heraldic division of the plate (solid / bend / fess / pale / roundel)
//   text    the initial (or monogram) of the displayed name
// The gold style drops tone and field (there's only one colour, gold) and
// leans on the ordinary (the shape of the gold band) plus the two-letter mark
// to carry the distinction instead.
//
// Seeded from the DISPLAYED NAME, never from playerCode or seat. Everyone can
// see every playerCode, including in the lobby, so a seal derived from it would
// stay identical across the lobby -> game transition and hand out the
// codename -> real-name mapping that anonymized mode exists to hide. Keying off
// the shown name means the seal changes exactly when the name does.
//
// Assignment is by sorted position among the current roster rather than by
// hashing the name: with 12 players and 12 tones (or 6 ordinaries) a hash
// collides better than nine times in ten, whereas an index cannot collide at
// all. The same index also drives the gold ordinary, so switching styles keeps
// each player's relative position (and thus adjacency to same-initial names)
// stable.

export const DEFAULT_SEAL_STYLE = 'ordinary';

// The bands painted onto a gold plate in src/style.css. 'plain' is deliberately
// first (and thus the fallback pattern) since it's the least decorated.
export const SEAL_ORDINARIES = ['plain', 'chief', 'base', 'barbell', 'bordure', 'flanks'];

export const SEAL_STYLES = [ // order = display order in the settings menu
  { id: 'ordinary', name: 'Gold ordinary', blurb: 'One plate, one colour. A heraldic mark struck in gold, plus two letters.' },
  // Deactivated: superseded by 'coloured-mono', which is strictly more
  // legible (same plate, two letters instead of one). Kept fully defined —
  // not deleted — so it still renders correctly for anyone already on it,
  // and re-enabling is a one-line `enabled: false` removal. SettingsMenu.vue
  // filters this out of the picker; nothing else needs to change to flip it
  // back on.
  { id: 'coloured', name: 'Coloured seals', blurb: 'A pigment tone and a divided field, with the operative\'s initial.', enabled: false },
  { id: 'coloured-mono', name: 'Coloured + letters', blurb: 'The same coloured seals, showing two letters instead of one.' },
];

function isKnownStyle(id) {
  return SEAL_STYLES.some(s => s.id === id);
}

function normalizeStyle(id) {
  return isKnownStyle(id) ? id : DEFAULT_SEAL_STYLE;
}

// Ordered so that adjacent indices are far apart in hue — a 5-player game uses
// only the first five slots, and those should look nothing like each other.
//
// Saturation is deliberately held in a narrow band (~0.09–0.24) so no single
// operative's plate shouts louder than the rest and the set reads as aged
// pigment rather than as a colour picker. That flattening does mean the warm
// tones would otherwise converge on the same tan, so gold / ochre / bronze /
// bone are pulled apart on LIGHTNESS instead of hue.
export const SEAL_PALETTE = [
  '#a08e6a', // aged gold
  '#7e4f4e', // oxblood
  '#5e8d78', // verdigris
  '#7e6991', // warp violet
  '#816551', // ochre
  '#6d7f97', // iron blue
  '#889565', // moss
  '#6b4e47', // rust
  '#597e88', // slate teal
  '#655743', // bronze
  '#9b9187', // bone grey
  '#544340', // dried blood
];

export const SEAL_FIELDS = ['solid', 'bend', 'fess', 'pale', 'roundel'];

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

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// First letter plus the next non-vowel — reads as a proper monogram (SB, SV,
// SN) rather than the first two raw characters, which for most names would
// just be a consonant and a vowel. Must never throw and never return empty:
// strip to A-Z0-9 first so punctuation/diacritics/emoji in a player-chosen
// display name can't break it, then fall back step by step toward the raw
// name if stripping leaves too little to work with.
//   'Sabine'->'SB'  'Sevatar'->'SV'  'Sanguinius'->'SN'  'Cain'->'CN'  'Castellan'->'CS'
function monogramOf(name) {
  const clean = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return initialOf(name);
  if (clean.length === 1) return clean;
  const first = clean[0];
  const rest = clean.slice(1);
  for (const ch of rest) {
    if (!VOWELS.has(ch)) return first + ch;
  }
  // No non-vowel anywhere after the first letter (e.g. 'Ai') — just take the
  // first two characters rather than manufacturing a letter from nothing.
  return first + rest[0];
}

function textFor(name, styleId) {
  // 'coloured' shows a single initial; the other two styles show a monogram.
  return styleId === 'coloured' ? initialOf(name) : monogramOf(name);
}

/**
 * Build a name -> seal lookup for one game's roster.
 * @param {string[]} names displayed names of the current players
 * @param {string} [styleId] one of SEAL_STYLES' ids
 * @returns {Map<string, object>} see the seal shapes documented at the top of this file
 */
export function buildSealMap(names, styleId = DEFAULT_SEAL_STYLE) {
  const style = normalizeStyle(styleId);
  const roster = [...new Set((names || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const map = new Map();
  roster.forEach((name, i) => {
    const text = textFor(name, style);
    if (style === 'ordinary') {
      map.set(name, { kind: 'gold', pattern: SEAL_ORDINARIES[i % SEAL_ORDINARIES.length], text });
    } else {
      const bg = SEAL_PALETTE[i % SEAL_PALETTE.length];
      map.set(name, {
        kind: 'colour',
        // Cycling the field on a different modulus than the tone means two
        // players who land on similar-looking tones still differ in field.
        pattern: SEAL_FIELDS[i % SEAL_FIELDS.length],
        text,
        bg,
        ink: inkFor(bg),
      });
    }
  });
  return map;
}

// For authors who aren't on the roster — system posts ("The Vox"), or a name
// from scrollback belonging to someone no longer listed. Neutral plate, no
// tone/pattern beyond the least-decorated option for the active style.
export function fallbackSeal(name, styleId = DEFAULT_SEAL_STYLE) {
  const style = normalizeStyle(styleId);
  const text = textFor(name, style);
  if (style === 'ordinary') {
    return { kind: 'gold', pattern: 'plain', text };
  }
  return { kind: 'colour', pattern: 'solid', text, bg: '#2a2c25', ink: '#b8b5a7' };
}

/** Inline style vars for a seal element — empty for 'gold' since the plate is
 *  painted entirely from CSS (no per-player colour to pass through). */
export function sealVars(seal) {
  if (!seal || seal.kind !== 'colour') return {};
  return { '--seal': seal.bg, '--seal-ink': seal.ink };
}
