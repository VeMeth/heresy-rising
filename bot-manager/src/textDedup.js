// Small local models tend to regenerate near-identical text when given
// similar prompt state — the same bot restating itself a round later once
// the specific chat that provoked it has scrolled out of context, or a
// DIFFERENT bot producing the same "safe" hedge sentence another bot already
// said (which can leak factually wrong content, e.g. one bot's vote
// justification claiming another bot's role verbatim). Static rules asking
// the model not to repeat itself are advisory only — this is the code-level
// backstop, checked before any chat/vote text is actually dispatched.

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(aWords, bWords) {
  if (!aWords.length || !bWords.length) return 0;
  const a = new Set(aWords);
  const b = new Set(bWords);
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * @param {string} text - candidate text about to be sent
 * @param {string[]} others - recent texts (own history + shared feed) to compare against
 * @param {number} threshold - Jaccard similarity (0-1) at/above which it's a duplicate
 * @returns {boolean}
 */
export function isNearDuplicate(text, others, threshold = 0.75) {
  const candidate = normalize(text);
  if (candidate.length < 4) return false; // too short to meaningfully judge — let it through
  for (const other of others) {
    if (jaccard(candidate, normalize(other)) >= threshold) return true;
  }
  return false;
}
