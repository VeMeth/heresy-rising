// Chat search — pure, framework-free helpers behind the in-game chat search
// box. Kept out of the Vue component so the query parsing / matching /
// highlighting logic can be reasoned about (and tested) without mounting
// anything.
//
// A chat message looks like:
//   { id, channel, author, body, kind, createdAt, meta, round, phase }
// `author` is a DISPLAY NAME, not a playerCode — see seals.js for why the
// UI never keys anything off the code.

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Splits on whitespace; a "quoted phrase" survives as one term with the
// quotes stripped, so a search for "night action" doesn't degenerate into
// two unrelated single-word terms. An unterminated trailing quote (someone
// still typing) is treated as one term running to the end of the string
// rather than thrown away, so the box never appears to eat a keystroke.
export function parseQuery(raw) {
  const s = String(raw ?? '');
  const terms = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      const close = s.indexOf('"', i + 1);
      if (close === -1) {
        terms.push(s.slice(i + 1).toLowerCase());
        i = s.length;
      } else {
        terms.push(s.slice(i + 1, close).toLowerCase());
        i = close + 1;
      }
    } else {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      terms.push(s.slice(i, j).toLowerCase());
      i = j;
    }
  }
  return { terms: terms.filter(Boolean) };
}

// Body only, deliberately never author: searching "marcus" should surface
// messages *about* Marcus, not be drowned out by every line Marcus himself
// wrote. Author gets its own separate filter control in the UI — conflating
// the two here would make this box useless in exactly the games with the
// chattiest players.
export function matches(message, terms) {
  if (!terms || !terms.length) return true;
  const body = (message?.body || '').toLowerCase();
  return terms.every(t => body.includes(t));
}

// Never render matches via v-html: message bodies are fully player-
// controlled text, so building an HTML string and injecting it would be an
// XSS sink. This returns plain segments instead so the caller can v-for
// over them and let Vue's own text interpolation escape each one — same
// technique as mentionSegments() in GameView.vue:471.
export function highlightSegments(text, terms) {
  const body = text || '';
  const sorted = (terms || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return [{ text: body, hit: false }];
  // Longest term first so a shorter term that's a prefix of a longer one
  // (e.g. "cult" vs "cultist") doesn't shadow the longer match.
  const pattern = new RegExp('(' + sorted.map(escapeRegExp).join('|') + ')', 'gi');
  const segments = [];
  let lastIndex = 0, match;
  while ((match = pattern.exec(body))) {
    if (match.index > lastIndex) segments.push({ text: body.slice(lastIndex, match.index), hit: false });
    segments.push({ text: body.slice(match.index, match.index + match[0].length), hit: true });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex++; // guard against a stray empty term
  }
  if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex), hit: false });
  return segments;
}

// Windows `body` around the first hit so a search result reads like a
// snippet rather than dumping the whole message. No hit (or no terms, e.g.
// an author-only filter) just shows the lede — the caller still needs
// something to render in the results list.
export function excerpt(body, terms, { radius = 90, max = 260 } = {}) {
  const text = body || '';
  const sorted = (terms || []).filter(Boolean).sort((a, b) => b.length - a.length);
  let hitIndex = -1, hitLen = 0;
  if (sorted.length) {
    const pattern = new RegExp('(' + sorted.map(escapeRegExp).join('|') + ')', 'i');
    const m = pattern.exec(text);
    if (m) { hitIndex = m.index; hitLen = m[0].length; }
  }
  if (hitIndex === -1) {
    if (text.length <= max) return text;
    // Don't split mid-word: back off to the last whitespace before the cap.
    let cut = text.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    return text.slice(0, cut).trimEnd() + '…';
  }
  let start = Math.max(0, hitIndex - radius);
  let end = Math.min(text.length, hitIndex + hitLen + radius);
  // Total length cap: shrink both sides but never past the hit itself.
  if (end - start > max) {
    const over = (end - start) - max;
    const shrinkLeft = Math.min(start, Math.ceil(over / 2));
    start += shrinkLeft;
    end -= (over - shrinkLeft);
    end = Math.max(end, hitIndex + hitLen);
  }
  if (start > 0) {
    // Snap backward to the nearest word boundary rather than forward: forward
    // scanning can (and did, for a hit whose preceding word fills the whole
    // radius) skip straight past the window and eat the leading context
    // entirely. Backward-snapping only ever pulls `start` earlier, so it
    // can only widen the window slightly, never collapse it.
    const sp = text.lastIndexOf(' ', start);
    if (sp !== -1) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp !== -1 && sp > hitIndex + hitLen) end = sp;
  }
  let out = text.slice(start, end);
  if (start > 0) out = '…' + out;
  if (end < text.length) out = out + '…';
  return out;
}

// Moved verbatim from PlayerDossier.vue so the template's two call sites
// and this module never drift apart. '·' (not '') is the real fallback for
// a message with no day/night phase (lobby, or a not-yet-stamped row) —
// keep it exactly as shipped, not as any prose description of it.
export function stampFor(n) {
  if (n.phase === 'day') return `D${n.round}`;
  if (n.phase === 'night') return `N${n.round}`;
  return '·';
}

// Fallback for rows written before the server started stamping round/phase
// on every message — those come through with both null. Cruder than
// GameView's nightStart() on purpose: nightStart() back-walks message by
// message to find exactly where night starts relative to player chatter,
// because it has to carve precise section boundaries for the day-log UI.
// This only has to answer "which Day N system marker did this pre-migration
// row follow?", so a single forward walk carrying the last-seen round
// suffices — phase is left null since a "Day N" marker alone doesn't tell
// us whether a given row landed during that day or the night after it.
export function deriveStamps(msgs) {
  const out = new Map();
  let round = null;
  for (const m of msgs || []) {
    if (m.kind === 'system' && /Day\s+\d+(\s*:|\s+begins)/i.test(m.body || '')) {
      const n = (m.body || '').match(/Day\s+(\d+)/i)?.[1];
      round = n ? Number(n) : round;
    }
    if (round != null) out.set(m.id, { round, phase: null });
  }
  return out;
}
