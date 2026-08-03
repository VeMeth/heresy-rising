// Memory primitives shared by `BotSession`. Pure data structures — no external
// storage in v1, full session-state lives in-process and dies when the manager
// restarts (except for the JSON snapshots BotPersistence writes).

// Short-term sliding window of recent chat messages, private intel returns,
// phase broadcasts — capped at `windowSize` (default 20 per spec).
export class BufferWindow {
  constructor({ windowSize = 20 } = {}) { this.windowSize = windowSize; this.items = []; }
  append(item) { this.items.push(item); while (this.items.length > this.windowSize) this.items.shift(); }
  flush() { this.items = []; }
  inspect() { return this.items.map((x) => Object.freeze(x)); }
  get length() { return this.items.length; }
}

// Structured notes — bot-curated key-value, capped to spec (key 64, value
// 500 chars) and to a maximum key count. Oldest-set key evicts first (FIFO)
// once the cap is exceeded, keeping the notes block within its prompt
// budget without an extra LLM consolidation pass. The cap defaults to the
// `MAX_KEYS` static (15, the `local`/scale-1 value) but is settable
// per-instance via the constructor so a profile with a larger `noteKeys`
// (40 m2.7 / 60 m3) can carry a longer note ledger — see
// BOT_MODEL_PROFILES_PLAN.md §3.6. Existing call sites that construct with
// no argument are unaffected.
export class StructuredNotes {
  static MAX_KEYS = 15;
  constructor({ maxKeys = StructuredNotes.MAX_KEYS } = {}) {
    this.map = new Map();
    this.maxKeys = maxKeys;
  }
  set(key, value) {
    if (!key) return false;
    const k = String(key).slice(0, 64);
    this.map.delete(k); // re-insert at the end so overwriting an existing key doesn't count as "old"
    this.map.set(k, String(value || '').slice(0, 500));
    while (this.map.size > this.maxKeys) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    return true;
  }
  get(key) { return this.map.get(String(key)); }
  all() { return Object.fromEntries(this.map); }
  get size() { return this.map.size; }
}

// RollingSummary — deterministic, code-built memory replacing the old
// LLM-driven `_consolidateMemory` call (one line per announcement, own
// vote/night action, or intel return — no extra LLM round-trip per bot per
// phase). Capped at MAX_LINES; oldest lines evict first (FIFO) so the
// summary always reflects the most recent rounds within its ~200 tok budget.
export class RollingSummary {
  static MAX_LINES = 20;
  constructor(lines) { this.lines = Array.isArray(lines) ? lines.slice(-RollingSummary.MAX_LINES) : []; }

  _push(line) {
    this.lines.push(line);
    if (this.lines.length > RollingSummary.MAX_LINES) this.lines.shift();
  }

  addAnnouncement(a, round) {
    if (!a) return;
    const label = a.title || a.type || 'event';
    const r = a.round ?? round;
    this._push(`[R${r ?? '?'}] ${label}: ${String(a.message || '').slice(0, 160)}`);
  }
  addOwnVote(round, target, justification) {
    this._push(`[R${round ?? '?'}] I voted ${target || 'skip'}${justification ? ` ("${String(justification).slice(0, 80)}")` : ''}.`);
  }
  addOwnNightAction(round, verb, target) {
    this._push(`[R${round ?? '?'}] I ${verb}${target ? ` -> ${target}` : ''}.`);
  }
  addIntelReturn(round, summary) {
    this._push(`[R${round ?? '?'}] Intel: ${String(summary || '').slice(0, 160)}`);
  }

  render() { return this.lines.join('\n'); }
  toJSON() { return this.lines; }
  static fromJSON(lines) { return new RollingSummary(lines); }
}
