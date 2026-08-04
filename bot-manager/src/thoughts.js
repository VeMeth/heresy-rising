// A process-wide, in-memory ring buffer of "what every bot thought, did, and
// declined to do" — the data source for the admin-only bot thoughts feed
// (BOT_THOUGHTS_FEED_PLAN.md §2.1/§2.3/§3).
//
// SECURITY — read this before touching anything in this file:
//
// Everything recorded here is admin-only hidden information: bot roles,
// factions, and a bot's private reasoning about who it thinks is a Heretic.
// That is fine to show a site admin debugging a run and catastrophic to leak
// to a player. This module MUST stay REST-only behind the same admin auth as
// every other bot-manager route, and its contents MUST NEVER be:
//   - broadcast to a game socket, or included in any player-facing payload;
//   - written into BotSession.snapshot() or data/bot-sessions/*.json — that
//     would leak reasoning text into on-disk backups and let the buffer grow
//     without the caps below ever kicking in.
//
// The buffer is memory-only and dies with the process, by design. It is an
// observability aid ("why did that bot just do that"), not an audit trail —
// do not "helpfully" persist it later; that turns a bounded debugging buffer
// into an unbounded leak of hidden game state.
//
// Shape of a stored entry (all fields optional except seq/ts/kind/summary —
// callers pass whatever context they have and this module fills in the rest):
//   {
//     seq, ts,                                  // seq is monotonic — the poll cursor; never reused, even across eviction
//     conclaveCode, botId, playerCode, botName,
//     profileId, role, faction, round, phase,    // admin-only context
//     kind,        // 'thinking' | 'action' | 'rejected' | 'suppressed' | 'error' | 'director'
//     summary,     // one human-readable line, always present
//     thought,     // reasoning text, may be null; truncated to THOUGHT_MAX_CHARS
//     detail        // { verb, target, text, reason, promptKind, tokens, latencyMs, finishReason, attempt, ... }
//   }
//
// Hard caps (all enforced defensively — see recordThought below):
//   - at most MAX_ENTRIES entries retained; oldest evicted first (ring buffer)
//   - `thought` truncated to THOUGHT_MAX_CHARS
//   - `detail.text` truncated to DETAIL_TEXT_MAX_CHARS
//
// recordThought() is called from hot paths — every LLM call, every action a
// bot takes — so it is written defensively and MUST NEVER THROW. An
// observability feature that can break a bot's turn is worse than no feature
// at all. Bad/malformed input is dropped (or best-effort sanitized), never
// propagated as an exception.

const MAX_ENTRIES = 500;
const THOUGHT_MAX_CHARS = 2000;
const DETAIL_TEXT_MAX_CHARS = 500;
const READ_LIMIT_MAX = 500; // rest.js clamps client-supplied `limit` to this too

const KINDS = new Set(['thinking', 'action', 'rejected', 'suppressed', 'error', 'director']);

let buffer = [];   // ring buffer, oldest first, length <= MAX_ENTRIES
let nextSeq = 1;   // monotonic; never reused even as entries are evicted

// Best-effort string coercion + truncation. Never throws — anything that
// can't be coerced to a string (circular object, Symbol, etc.) becomes null
// rather than blowing up the caller's hot path.
function safeTruncate(value, maxChars) {
  if (value == null) return null;
  let str;
  try {
    str = typeof value === 'string' ? value : String(value);
  } catch {
    return null;
  }
  if (str.length > maxChars) return str.slice(0, maxChars);
  return str;
}

// Shallow-sanitize the `detail` object: only pass through plain-ish values,
// truncate `text`, and never let a circular/huge object escape into the
// buffer (JSON.stringify on it later — e.g. in the REST response — would
// throw on a cycle and could take down the whole /thoughts endpoint).
function safeDetail(detail) {
  if (detail == null || typeof detail !== 'object') return null;
  const out = {};
  for (const key of Object.keys(detail)) {
    const v = detail[key];
    if (v == null) { out[key] = v; continue; }
    const t = typeof v;
    if (t === 'string') {
      out[key] = key === 'text' ? safeTruncate(v, DETAIL_TEXT_MAX_CHARS) : safeTruncate(v, DETAIL_TEXT_MAX_CHARS);
    } else if (t === 'number' || t === 'boolean') {
      out[key] = v;
    } else {
      // Objects/arrays/functions/symbols in detail fields are not part of
      // the documented shape — stringify best-effort and truncate, dropping
      // silently if even that fails (e.g. a circular reference).
      out[key] = safeTruncate(v, DETAIL_TEXT_MAX_CHARS);
    }
  }
  return out;
}

/**
 * Append an entry to the ring buffer. Assigns `seq` (monotonic, never
 * reused) and `ts` (Date.now()), enforces the hard caps, and evicts the
 * oldest entry once MAX_ENTRIES is exceeded.
 *
 * Never throws. Malformed input (null, missing `kind`/`summary`, a
 * circular `detail`, a 1MB `thought`) is sanitized or dropped rather than
 * propagated, because this is called from hot paths (every LLM call, every
 * bot action) where a throw would break the bot's turn.
 *
 * @param {object} entry
 * @returns {object|null} the stored entry (with seq/ts assigned), or null if
 *   the input was unusable (e.g. not an object, or missing a valid `kind`).
 */
export function recordThought(entry) {
  try {
    if (!entry || typeof entry !== 'object') return null;
    const kind = KINDS.has(entry.kind) ? entry.kind : null;
    if (!kind) return null; // an entry with no recognized kind is not useful to a reader filtering by kind

    const stored = {
      seq: nextSeq++,
      ts: Date.now(),
      conclaveCode: safeTruncate(entry.conclaveCode, 200),
      botId: safeTruncate(entry.botId, 200),
      playerCode: safeTruncate(entry.playerCode, 200),
      botName: safeTruncate(entry.botName, 200) || safeTruncate(entry.botId, 200) || 'Bot',
      profileId: safeTruncate(entry.profileId, 200),
      role: safeTruncate(entry.role, 100),
      faction: safeTruncate(entry.faction, 100),
      round: typeof entry.round === 'number' ? entry.round : null,
      phase: safeTruncate(entry.phase, 50),
      kind,
      summary: safeTruncate(entry.summary, 500) || '',
      thought: safeTruncate(entry.thought, THOUGHT_MAX_CHARS),
      detail: safeDetail(entry.detail)
    };

    buffer.push(stored);
    if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
    return stored;
  } catch {
    // Whatever went wrong, this call must not propagate — drop the entry.
    return null;
  }
}

/**
 * Read entries from the buffer, oldest-first.
 *
 * @param {object} [opts]
 * @param {number} [opts.since=0]          only entries with seq > since
 * @param {string} [opts.conclaveCode]     exact match filter
 * @param {string} [opts.botId]            exact match filter
 * @param {string[]} [opts.kinds]          if given, only these kinds
 * @param {number} [opts.limit=200]        max entries returned, clamped to READ_LIMIT_MAX
 * @returns {{entries: object[], latestSeq: number, dropped: boolean}}
 *   `entries` — oldest-first, after filtering, capped at `limit`.
 *   `latestSeq` — the highest seq currently in the buffer (0 if empty); safe to
 *     use as the next poll's `since` even when `entries` came back empty.
 *   `dropped` — true if filtering matched more entries than `limit` allowed,
 *     i.e. the caller did not get the full matching set and should poll again
 *     with `since` advanced to the last entry it received rather than assuming
 *     it has caught up.
 */
export function readThoughts(opts = {}) {
  const since = Number.isFinite(opts.since) ? opts.since : 0;
  const conclaveCode = opts.conclaveCode || null;
  const botId = opts.botId || null;
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? new Set(opts.kinds) : null;
  let limit = Number.isFinite(opts.limit) ? opts.limit : 200;
  if (limit < 1) limit = 1;
  if (limit > READ_LIMIT_MAX) limit = READ_LIMIT_MAX;

  const latestSeq = buffer.length ? buffer[buffer.length - 1].seq : 0;

  const matched = buffer.filter((e) => {
    if (e.seq <= since) return false;
    if (conclaveCode && e.conclaveCode !== conclaveCode) return false;
    if (botId && e.botId !== botId) return false;
    if (kinds && !kinds.has(e.kind)) return false;
    return true;
  });

  const dropped = matched.length > limit;
  const entries = dropped ? matched.slice(0, limit) : matched;

  return { entries, latestSeq, dropped };
}

// Test-only: clear the buffer and reset the seq counter. Never call this
// from production code.
export function _resetThoughtsForTests() {
  buffer = [];
  nextSeq = 1;
}
