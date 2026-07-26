import { ConversationDirector } from './director.js';

// In-process registry of active BotSession objects, keyed by botId (which is
// also the bot's player code issued by the engine — same value, unique per
// session). Also owns one ConversationDirector per conclave, created lazily
// on the first bot registered for that conclave and torn down when the last
// bot for that conclave is removed.
export class SessionStore {
  /** @param {{config?:object}} [params] */
  constructor({ config } = {}) {
    this.sessions = new Map();
    this._config = config || {};
    this._directors = new Map(); // conclaveCode -> ConversationDirector
  }

  add(session) {
    this.sessions.set(session.id, session);
    const director = this._directorFor(session.conclaveCode);
    director.registerBot(session);
    session._director = director;
    return session;
  }

  get(id) { return this.sessions.get(id); }
  list() { return [...this.sessions.values()]; }

  remove(id) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    if (s && s._director) {
      s._director.unregisterBot(s.playerCode);
      const stillPresent = [...this.sessions.values()].some((x) => x.conclaveCode === s.conclaveCode);
      if (!stillPresent) {
        s._director.close();
        this._directors.delete(s.conclaveCode);
      }
    }
    return s;
  }

  count() { return this.sessions.size; }

  _directorFor(conclaveCode) {
    let d = this._directors.get(conclaveCode);
    if (!d) {
      d = new ConversationDirector({ conclaveCode, config: this._config });
      this._directors.set(conclaveCode, d);
    }
    return d;
  }

  async closeAll() {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.close()));
    for (const d of this._directors.values()) d.close();
    this._directors.clear();
  }
}
