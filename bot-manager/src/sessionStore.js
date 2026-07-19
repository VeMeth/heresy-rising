// In-process registry of active BotSession objects, keyed by botId (which is
// also the bot's player code issued by the engine — same value, unique per
// session).
export class SessionStore {
  constructor() { this.sessions = new Map(); }
  add(session) { this.sessions.set(session.id, session); return session; }
  get(id) { return this.sessions.get(id); }
  list() { return [...this.sessions.values()]; }
  remove(id) { const s = this.sessions.get(id); this.sessions.delete(id); return s; }
  count() { return this.sessions.size; }
  async closeAll() { await Promise.allSettled([...this.sessions.values()].map((s) => s.close())); }
}