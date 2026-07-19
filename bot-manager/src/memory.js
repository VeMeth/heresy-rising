// Memory primitives shared by `BotSession`. Pure data structures — no external
// storage in v1, full session-state lives in-process and dies when the manager
// restarts.

// Short-term sliding window of recent chat messages, private intel returns,
// phase broadcasts — capped at `windowSize` (default 20 per spec).
export class BufferWindow {
  constructor({ windowSize = 20 } = {}) { this.windowSize = windowSize; this.items = []; }
  append(item) { this.items.push(item); while (this.items.length > this.windowSize) this.items.shift(); }
  flush() { this.items = []; }
  inspect() { return this.items.map((x) => Object.freeze(x)); }
  get length() { return this.items.length; }
}

// Structured notes — bot-curated key-value, capped to spec (key 64, value 500).
export class StructuredNotes {
  constructor() { this.map = new Map(); }
  set(key, value) {
    if (!key) return false;
    this.map.set(String(key).slice(0, 64), String(value || '').slice(0, 500));
    return true;
  }
  get(key) { return this.map.get(String(key)); }
  all() { return Object.fromEntries(this.map); }
  get size() { return this.map.size; }
}