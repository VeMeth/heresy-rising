// ConversationDirector — heuristic, no-LLM turn-taking controller for one
// conclave's public day chat. Replaces the old per-bot reactive debounce
// (session.js's deleted _chatTimer/echo-guard machinery) with a single
// process per conclave that decides WHICH bot (if any) speaks on each tick.
// An LLM-driven director was considered and rejected — it would double the
// load on an already-serialized local model (one call to pick a speaker,
// another to speak).
import { queueDepth } from './llm/queue.js';

const RING_SIZE = 30;

function hashTalkativeness(playerCode) {
  // Deterministic 0.4-0.9 spread from the player code, so a bot's
  // talkativeness is stable across restarts without persisting it.
  let h = 0;
  for (let i = 0; i < String(playerCode).length; i++) h = (h * 31 + playerCode.charCodeAt(i)) >>> 0;
  return 0.4 + ((h % 1000) / 1000) * 0.5;
}

export class ConversationDirector {
  constructor({ conclaveCode, config, now = Date.now, autoTick = true } = {}) {
    this.conclaveCode = conclaveCode;
    this._config = config || {};
    this._now = now;
    this._feed = []; // ring buffer, oldest first
    this._seenIds = new Set();
    this._bots = new Map(); // playerCode -> BotSession
    this._botState = new Map(); // playerCode -> { talkativeness, lastSpokeAt, spokenThisPhase, introduced }
    this._introQueue = [];
    this._lastIntroAt = -Infinity;
    this._turnInFlight = false;
    this._lastPhase = null;
    this._timer = null;
    if (autoTick) {
      const tickMs = Number(this._config.directorTickMs) || 4000;
      this._timer = setInterval(() => {
        this._tick().catch((e) => console.warn(`[director] tick error (${conclaveCode}):`, e.message));
      }, tickMs);
      if (this._timer.unref) this._timer.unref();
    }
  }

  registerBot(session) {
    this._bots.set(session.playerCode, session);
    if (!this._botState.has(session.playerCode)) {
      const override = session.personaOverrides && typeof session.personaOverrides === 'object' ? session.personaOverrides.talkativeness : undefined;
      const talk = typeof override === 'number' ? Math.min(0.9, Math.max(0.4, override)) : hashTalkativeness(session.playerCode);
      this._botState.set(session.playerCode, { talkativeness: talk, lastSpokeAt: -Infinity, spokenThisPhase: false, introduced: false });
      session.talkativeness = talk; // surfaced into the persona block
    }
  }

  unregisterBot(playerCode) {
    this._bots.delete(playerCode);
    this._botState.delete(playerCode);
    this._introQueue = this._introQueue.filter((id) => id !== playerCode);
  }

  hasBots() { return this._bots.size > 0; }

  onPhaseChange(phase) {
    if (phase === this._lastPhase) return;
    for (const st of this._botState.values()) st.spokenThisPhase = false;
    this._lastPhase = phase;
    if (phase === 'day') this._maybeSeedIntroQueue();
  }

  // Called by every BotSession's _onChatMessage for every public message it
  // observes (human or bot) — deduped by message id so N bots forwarding the
  // same message only inserts it once into the shared feed.
  observe({ id, from, author, isBot, text, round }) {
    const key = id ?? `${from}:${text}:${round}`;
    if (this._seenIds.has(key)) return;
    this._seenIds.add(key);
    this._feed.push({ id: key, from, author, isBot, text, ts: this._now() });
    if (this._feed.length > RING_SIZE) this._feed.shift();
  }

  // Recent public message text (chat AND vote-justification bodies — both
  // arrive through the same public-channel pipeline) for the anti-duplicate
  // check in session.js. A local model given similar prompt state across
  // different bots/rounds tends to regenerate near-identical text; this is
  // the cross-bot half of that check (the bot's own actionLog covers the
  // same-bot, same-conversation-window-scrolled-out case).
  recentTexts(n = 12) {
    return this._feed.slice(-n).map((m) => m.text).filter(Boolean);
  }

  _maybeSeedIntroQueue() {
    if (this._introQueue.length) return;
    const uninitiated = [...this._botState.entries()].filter(([, st]) => !st.introduced).map(([id]) => id);
    if (!uninitiated.length) return;
    for (let i = uninitiated.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uninitiated[i], uninitiated[j]] = [uninitiated[j], uninitiated[i]];
    }
    this._introQueue = uninitiated;
  }

  async _tick() {
    if (this._turnInFlight) return;
    if (queueDepth() > 2) return; // backpressure — let engine prompts drain first
    if (this._lastPhase !== 'day') return; // public chat is night-closed

    // 1) Day-1 introductions: one bot per >= BOT_INTRO_GAP_MS, guarantees a
    // staggered intro even in a completely silent lobby.
    const introGap = Number(this._config.botIntroGapMs) || 12000;
    if (this._introQueue.length && this._now() - this._lastIntroAt >= introGap) {
      const id = this._introQueue.shift();
      const session = this._bots.get(id);
      const st = this._botState.get(id);
      if (session && st) {
        this._lastIntroAt = this._now();
        await this._speak(session, st, 'introduce yourself on Day 1');
        st.introduced = true; // set even on error/pass — never re-queue
        return;
      }
    }

    // 2) Reactive scoring — silence is the default.
    const scored = [];
    for (const [id, session] of this._bots) {
      const st = this._botState.get(id);
      if (!st || !session.alive) continue;
      const score = this._score(session, st);
      if (score > 0) scored.push({ session, st, score });
    }
    if (!scored.length) return;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    await this._speak(top.session, top.st, 'reactive');
  }

  _score(session, st) {
    const minGap = Number(this._config.botMinChatGapMs) || 25000;
    const perPhaseMax = Number(this._config.botChatPerPhaseMax) || 3;
    if (this._now() - st.lastSpokeAt < minGap) return 0;
    if ((session._chatSentThisPhase || 0) >= perPhaseMax) return 0;
    if (!this._feed.length) return 0;

    const newest = this._feed[this._feed.length - 1];
    if (newest.from === session.playerCode) return 0; // never self-reply
    if (newest.isBot) return 0; // never chain a reply off another bot's message
    const lastN = this._feed.slice(-3);
    if (lastN.length === 3 && lastN.every((m) => m.isBot)) return 0; // echo guard

    // Only genuinely new human/system messages are a reason to speak — bot
    // chatter alone must never motivate another bot to reply (that's the
    // cascade that produces "nothing to add" restatements of its own role).
    let score = 0;
    const lower = (session.name || '').toLowerCase();
    for (const m of this._feed.slice(-6)) {
      if (m.isBot) continue;
      if (m.ts <= st.lastSpokeAt) continue; // already accounted for
      if (lower && m.text && m.text.toLowerCase().includes(lower)) score += 3; // name-mentioned by human
      else score += 2; // new human/system message
    }
    if (score === 0) return 0;
    const weighted = score * st.talkativeness;
    const threshold = Number(this._config.botReactiveThreshold) || 1.0;
    return weighted >= threshold ? weighted : 0;
  }

  async _speak(session, st, reason) {
    this._turnInFlight = true;
    try {
      // Staleness re-check at dequeue time — state may have moved on while
      // this tick was scheduled (phase changed, bot died, cap hit).
      if (!session.alive || this._lastPhase !== 'day') return;
      if ((session._chatSentThisPhase || 0) >= (Number(this._config.botChatPerPhaseMax) || 3)) return;
      st.lastSpokeAt = this._now();
      await session.takeChatTurn(reason);
    } catch (e) {
      console.warn(`[director] speak failed for ${session.playerCode}:`, e.message);
    } finally {
      this._turnInFlight = false;
    }
  }

  close() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._bots.clear();
    this._botState.clear();
  }
}
