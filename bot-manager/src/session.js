import { openEngineSocket } from './engineSocket.js';
import { BufferWindow, StructuredNotes } from './memory.js';
import { buildEnginePayload } from './actionDispatch.js';
import { actionValidator } from './validator.js';
import { BotPersistence } from './persistence.js';

// Fixed delay before the bot emits an action after being prompted (Q-BOT-1
// resolution: "Fixed delay (e.g. 10s)"). Looked up from
// config.botActionDelayMs, default 10000ms. The decision loop debounces chat
// responses with a separate shorter window (config.chatDebounceMs).
//
// Phase 3 wires the engine Socket.IO client + the decision loop against a
// pluggable `llm` (Phase 4 swaps in ChatMiniMax / MockLLM). Until then, a
// PassThroughLLM makes the bot observe silently.
export class BotSession {
  constructor({ id, conclaveCode, playerCode, name, personaOverrides, costCeiling, config, llm, engineBaseUrl, persistence, snapshot: snap } = {}) {
    this.id = id;
    this.playerCode = playerCode || id;
    this.conclaveCode = conclaveCode;
    this.name = name || 'Heretic Bot';
    this._persistence = persistence || null;
    if (snap) {
      // Restore from a previously-saved snapshot.
      this.role = snap.role ?? null;
      this.faction = snap.faction ?? null;
      this.claim = snap.claim ?? null;
      this.alive = snap.alive ?? true;
      this.phase = snap.phase ?? 'lobby';
      this.round = snap.round ?? 0;
      this.botIds = Array.isArray(snap.botIds) ? snap.botIds : [];
      this.sessionInit = snap.sessionInit ?? null;
      this.personaOverrides = snap.personaOverrides ?? null;
      this.costCeiling = snap.costCeiling ?? (config?.maxTokensPerGame || 50000);
      this.tokensUsed = snap.tokensUsed ?? 0;
      this.lastAction = snap.lastAction || 'restored';
      this.startedAt = snap.startedAt ?? Date.now();
      this.shortTermMemory = new BufferWindow({ windowSize: 20 });
      if (Array.isArray(snap.shortTermMemory)) {
        for (const item of snap.shortTermMemory) this.shortTermMemory.append(item);
      }
      this.notes = new StructuredNotes();
      if (snap.notes && typeof snap.notes === 'object') {
        for (const [k, v] of Object.entries(snap.notes)) this.notes.set(k, v);
      }
      this.actionLog = [];
    } else {
      this.role = null;
      this.faction = null;
      this.claim = null;
      this.alive = true;
      this.phase = 'lobby';
      this.round = 0;
      this.botIds = [];
      this.sessionInit = null;
      this.personaOverrides = personaOverrides || null;
      this.costCeiling = costCeiling || config.maxTokensPerGame;
      this.tokensUsed = 0;
      this.lastAction = 'init';
      this.startedAt = Date.now();
      this.shortTermMemory = new BufferWindow({ windowSize: 20 });
      this.notes = new StructuredNotes();
      this.actionLog = [];
    }
    this._config = config;
    this._llm = llm || { async generate() { return { kind: 'pass' }; _label: 'passthrough' } };
    this._engineBaseUrl = engineBaseUrl;
    this._socket = null;
    this._joinPromise = null;
    this._chatTimer = null;
    this._actTimer = null;
    this._consolidateTimer = null;
    this._closing = false;
    // Per-bot random stagger to avoid all bots hitting the LLM API simultaneously.
    // Acts (night/vote prompts) get 0..botActionDelayMs of extra jitter;
    // chat replies get 0..botActionDelayMs of extra jitter (wider range than the
    // debounce window itself, so bots spread across a meaningful timespan).
    const actJitter = Math.random() * Number(config?.botActionDelayMs || 10000);
    const chatJitter = Math.random() * Number(config?.botActionDelayMs || 10000);
    this._actJitterMs = Math.floor(actJitter);
    this._chatJitterMs = Math.floor(chatJitter);
    this.connect();
  }

  /** Serialise session state to a plain object for persistence. */
  snapshot() {
    const s = {
      id: this.id,
      playerCode: this.playerCode,
      conclaveCode: this.conclaveCode,
      name: this.name,
      role: this.role,
      faction: this.faction,
      claim: this.claim,
      alive: this.alive,
      phase: this.phase,
      round: this.round,
      botIds: this.botIds,
      sessionInit: this.sessionInit,
      personaOverrides: this.personaOverrides,
      costCeiling: this.costCeiling,
      tokensUsed: this.tokensUsed,
      lastAction: this.lastAction,
      startedAt: this.startedAt,
      shortTermMemory: this.shortTermMemory.items,
      notes: this.notes.all()
    };
    return s;
  }

  /** Persist this session's state to disk (fire-and-forget). */
  _save() {
    if (this._persistence) this._persistence.save(this);
  }

  setNote(key, value) { return this.notes.set(key, value); }
  getNotes() { return this.notes.all(); }
  inspect() {
    return {
      botId: this.id,
      playerCode: this.playerCode,
      conclaveCode: this.conclaveCode,
      name: this.name,
      role: this.role,
      faction: this.faction,
      phase: this.phase,
      round: this.round,
      alive: this.alive,
      lastAction: this.lastAction,
      memoryBytes: this.shortTermMemory.length,
      notesCount: this.notes.size,
      tokensUsed: this.tokensUsed,
      costCeiling: this.costCeiling,
      startedAt: this.startedAt,
      connected: !!(this._socket && this._socket.connected),
      llmPassive: !!(this._llm && (this._llm.label === 'passthrough' || this._llm._label === 'passthrough')),
      shortTermMemory: this.shortTermMemory.inspect(),
      actionLog: this.actionLog,
      sessionInit: this.sessionInit,
      personaOverrides: this.personaOverrides,
      alivePlayers: this.alivePlayers,
      winner: this.winner
    };
  }

  connect() {
    if (!this._engineBaseUrl || this._socket || this._closing) return;
    const { socket, joinPromise } = openEngineSocket({
      baseUrl: this._engineBaseUrl,
      conclaveCode: this.conclaveCode,
      playerCode: this.playerCode
    });
    this._socket = socket;
    this._joinPromise = joinPromise;

    socket.on('game:state', (p) => this._onGameState(p));
    socket.on('phase:updated', (p) => this._onGameState(p));
    socket.on('chat:message', (m) => this._onChatMessage(m));
    socket.on('game:announcement', (a) => this._onAnnouncement(a));
    socket.on('vote:state', (v) => this._onVoteState(v));
    socket.on('bot:session_init', (p) => this._onSessionInit(p));
    socket.on('night_action_prompt', (p) => this._scheduleAct(p));
    socket.on('day_vote_prompt', (p) => this._scheduleAct(p));
    socket.on('game:ended', (p) => { this._onGameEnded(p); this.lastAction = 'game_over'; });

    socket.on('connect', () => { this.lastAction = 'connected'; });
    socket.on('disconnect', (reason) => { this.lastAction = `disconnected:${reason}`; });

    joinPromise.then(() => { this.lastAction = 'joined'; })
      .catch((err) => { console.warn(`[bot-manager] socket join failed for ${this.id}:`, err.message); this.lastAction = 'join_failed'; });
  }

  _onGameState(payload) {
    const s = payload?.state;
    if (!s) return;
    this.phase = s.phase ?? this.phase;
    this.round = s.round ?? this.round;
    if (s.me) {
      this.alive = !!s.me.alive;
      if (s.me.role && typeof s.me.role === 'object') this.role = s.me.role.id || this.role;
      else if (typeof s.me.role === 'string') this.role = s.me.role;
      if (s.me.faction) this.faction = s.me.faction;
      this._latestMe = s.me;
    }
    if (Array.isArray(s.players)) {
      // Track the codes of all currently-alive players. The bot is drift-blind
      // — it only sees codes from public roster, never drift values or zones.
      this.alivePlayers = s.players.filter((p) => p.alive).map((p) => p.playerCode);
      // Build a name→code map so the bot can refer to players by name in chat.
      this.playerNames = {};
      for (const p of s.players) {
        if (p.name && p.playerCode) this.playerNames[p.playerCode] = p.name;
      }
      // other-bot visibility already comes through bot:session_init
    }
    if (this._lastPhase && this._lastPhase !== this.phase) {
      // Phase changed — reset phase-scoped counters and schedule consolidation.
      this._botMessagesThisPhase = 0;
      this._scheduleConsolidation();
    }
    // Reset per-round vote tracking on round change.
    if (this._lastRound !== this.round) {
      this._lastVoteTarget = null;
      this._lastRound = this.round;
    }
    this._lastPhase = this.phase;
    if (Array.isArray(s.privateMessages) && s.privateMessages.length) {
      for (const m of s.privateMessages) {
        if (m.meta && (m.meta.intelKind || m.meta.drift_hint)) {
          this.shortTermMemory.append({ kind: 'intel_return', ...m.meta, round: this.round });
        }
      }
    }
    if (this.lastAction !== 'killed' && this.lastAction !== 'game_over') this.lastAction = `state:${this.phase}`;
    this._save();
  }

  _onChatMessage(payload) {
    const m = payload?.message;
    if (!m) return;
    if (m.player_code === this.playerCode) return; // ignore our own
    if (m.channel && m.channel !== 'public') return; // public only; faction handled separately
    this.shortTermMemory.append({ kind: 'chat_message', from: m.player_code, author: m.author, text: m.body, round: this.round, phase: this.phase });
    // If it's day chat and not in cooldown, schedule a debounced chat reply.
    this._save();
    if (this.phase === 'day' && this._config.chatDebounceMs > 0) {
      // Track total bot messages this phase. Once bots have flooded the channel
      // enough, they stop replying until the next phase. This prevents echo
      // chambers even if a human occasionally chimes in.
      const isBot = Array.isArray(this.botIds) && this.botIds.includes(m.player_code);
      if (isBot) {
        this._botMessagesThisPhase = (this._botMessagesThisPhase || 0) + 1;
      }
      if ((this._botMessagesThisPhase || 0) >= 12) return;
      if (this._chatTimer) clearTimeout(this._chatTimer);
      this._chatTimer = setTimeout(() => this._act({ kind: 'chat_reply' }).catch(() => {}), this._config.chatDebounceMs + (this._chatJitterMs || 0));
    }
  }

  _onAnnouncement(payload) {
    const a = payload?.announcement;
    if (!a) return;
    this.shortTermMemory.append({ kind: 'announcement', type: a.type, title: a.title, message: a.message });
    this._save();
  }

  _onVoteState(_payload) { /* votes are visible via state; nothing extra needed */ }

  _onSessionInit(payload) {
    if (!payload) return;
    this.role = payload.role?.id || payload.role || this.role;
    this.faction = payload.faction ?? this.faction;
    this.claim = payload.claim ?? this.claim;
    this.phase = payload.phase ?? this.phase;
    this.round = payload.round ?? this.round;
    this.botIds = Array.isArray(payload.botIds) ? payload.botIds : [];
    this.sessionInit = payload;
    this.lastAction = 'session_init';
    this._save();
  }

  _onGameEnded(payload) {
    this.sessionInit = null;
    this.phase = 'ended';
    this.lastAction = 'game_over';
    if (payload?.state?.winner) this.winner = payload.state.winner;
    this._save();
  }

  _scheduleAct(prompt) {
    if (this._closing) return;
    if (this._actTimer) clearTimeout(this._actTimer);
    const baseDelay = Math.max(0, Number(this._config.botActionDelayMs) || 0);
    const delay = baseDelay + (this._actJitterMs || 0);
    this._actTimer = setTimeout(() => {
      this._act(prompt).catch((e) => console.warn(`[bot-manager] act errored for ${this.id}:`, e.message));
      this._actTimer = null;
    }, delay);
  }

  async _act(prompt) {
    if (!this.alive || this._closing) return;
    if (this.tokensUsed >= this.costCeiling) {
      this.lastAction = 'budget_exhausted';
      return;
    }
    let action;
    try {
      action = await this._llm.generate({ session: this, prompt });
    } catch (e) {
      console.warn(`[bot-manager] LLM generate failed for ${this.id}:`, e.message);
      this.lastAction = 'llm_error';
      this._logAction({ kind: 'llm_error', error: e.message });
      return;
    }
    if (!action) { this.lastAction = 'pass'; this._logAction({ kind: 'pass' }); return; }

    // Forward any notes the bot wants to persist into its structured memory.
    // Notes are write-only side effects — apply them even on `pass` so the bot
    // can record observations without taking an action this turn.
    if (action.notes && typeof action.notes === 'object') {
      for (const [k, v] of Object.entries(action.notes)) this.notes.set(k, v);
    }

    this._save();
    if (action.kind === 'pass') { this.lastAction = 'pass'; this._logAction({ kind: 'pass' }); return; }

    // Soft pre-validation. Engine is still the source of truth — but if our
    // validator catches an obvious violation (self-target, day-1 vote, etc.)
    // we downgrade to pass rather than waste a round-trip on a rejected
    // action.
    const validation = actionValidator(this.role, action, this._validatorContext());
    if (!validation.ok) {
      console.warn(`[bot-manager] validator rejected action for ${this.id} (${this.role}): ${validation.reason}`);
      this.lastAction = `rejected:${validation.reason}`;
      this._logAction({ kind: 'rejected', action, reason: validation.reason });
      return;
    }

    // Prevent re-voting for the SAME target. Changing your vote based on new
    // intel is fine — but re-casting the same vote floods chat with
    // duplicate justifications.
    if (action.kind === 'vote' && action.target && this._lastVoteTarget === action.target) {
      this.lastAction = 'pass';
      this._logAction({ kind: 'pass', note: `already voted for ${action.target} this round` });
      return;
    }

    const dispatch = buildEnginePayload(action, this);
    if (!dispatch) { this.lastAction = 'invalid_action'; this._logAction({ kind: 'invalid_action', action }); return; }
    if (dispatch.type === 'pass' || dispatch.type === 'sleep') { this.lastAction = dispatch.type; this._logAction({ kind: dispatch.type, action }); return; }
    if (!this._socket || !this._socket.connected) { this.lastAction = 'socket_offline'; this._logAction({ kind: 'socket_offline', action }); return; }

    if (dispatch.type === 'chat') {
      this._emit('chat:send', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`chat:send rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'chat';
      this._logAction({ kind: 'chat', action, target: dispatch.payload?.target, text: dispatch.payload?.body });
    } else if (dispatch.type === 'vote') {
      this._emit('vote:submit', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`vote:submit rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'vote';
      this._lastVoteTarget = dispatch.payload?.target || 'skip';
      this._logAction({ kind: 'vote', action, target: dispatch.payload?.target });
    } else if (dispatch.type === 'action') {
      this._emit('action:submit', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`action:submit rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = `action:${action.verb}`;
      this._logAction({ kind: 'action', verb: action.verb, action, target: dispatch.payload?.target, targetCode: dispatch.payload?.targetCode });
    }
  }

  _scheduleConsolidation() {
    // Don't schedule if already closing, or if there's nothing to consolidate.
    if (this._closing) return;
    const items = this.shortTermMemory?.items || [];
    if (items.length === 0) return;

    // Cancel any pending consolidation (shouldn't happen but be safe).
    if (this._consolidateTimer) { clearTimeout(this._consolidateTimer); }

    // Use a short delay so the new phase's action prompt gets priority.
    const delay = Math.min(2000, Number(this._config?.botActionDelayMs || 10000) / 5);
    this._consolidateTimer = setTimeout(() => {
      this._consolidateMemory().catch((e) => console.warn(`[bot-manager] consolidate failed for ${this.id}:`, e.message));
      this._consolidateTimer = null;
    }, delay);
  }

  async _consolidateMemory() {
    if (this._closing) return;
    const items = this.shortTermMemory?.items || [];
    if (items.length === 0) return;

    // Render short-term memory as bullet points for the LLM.
    const memoryLines = items.map((it) => {
      if (it.kind === 'chat_message') return `${it.author || it.from || '?'}: "${it.text || ''}"`;
      if (it.kind === 'announcement') return `[ANNOUNCEMENT] ${it.title || it.type || ''}: ${it.message || ''}`;
      if (it.kind === 'intel_return') return `[INTEL] ${it.intelKind || 'info'}: ${JSON.stringify(it)}`;
      return `[${it.kind || 'event'}]: ${JSON.stringify(it)}`;
    });

    const lastPhase = this._lastPhase || this.phase;
    const prompt = {
      kind: 'memory_consolidation',
      phase: lastPhase,
      round: this.round,
      memory: memoryLines
    };

    let response;
    try {
      response = await this._llm.generate({ session: this, prompt });
    } catch (e) {
      console.warn(`[bot-manager] consolidate LLM error for ${this.id}:`, e.message);
      return;
    }

    // Save any notes the LLM returned.
    if (response?.notes && typeof response.notes === 'object') {
      for (const [k, v] of Object.entries(response.notes)) {
        this.notes.set(k, v);
      }
    }

    // Prune old phase notes — keep at most 6 (3 full rounds).
    const allNotes = this.notes.all();
    const phaseKeys = Object.keys(allNotes).filter((k) => k.startsWith('phase-'));
    if (phaseKeys.length > 6) {
      const toRemove = phaseKeys.sort().slice(0, phaseKeys.length - 6);
      for (const k of toRemove) this.notes.map.delete(k);
    }

    // Flush short-term memory now that we've summarised it.
    this.shortTermMemory.flush();
    this._save();
  }

  _logAction(entry) {
    this.actionLog.push({ ts: Date.now(), phase: this.phase, round: this.round, ...entry });
    // Cap the log to the last 50 entries
    if (this.actionLog.length > 50) this.actionLog.splice(0, this.actionLog.length - 50);
  }

  // Unwraps socket.io's `(err, ack)` callback shape so the rest of the session
// code can treat its callback as if it only received the ack.
_emit(event, payload, cb) {
    try {
      this._socket.timeout(5000).emit(event, payload, (err, ack) => {
        if (err) cb && cb({ ok: false, error: `${event} timed out`, timedOut: true });
        else cb && cb(ack || { ok: true });
      });
    } catch (e) { console.warn(`[bot-manager] emit ${event} failed ${this.id}:`, e.message); }
  }

  // Snapshot for the manager-side validator. Built from the latest game state
  // we observed. Missing fields are tolerated (validator degrades).
  _validatorContext() {
    const me = this._latestMe || {};
    return {
      selfCode: this.playerCode,
      phase: this.phase,
      round: this.round,
      votingEnabled: this.phase === 'day' ? this.round !== 1 : false,
      crippleTier: me.crippleTier ?? 0,
      alivePlayers: this.alivePlayers,
      usage: me.usage || {},
      lastProtectTarget: me.lastProtectTarget || null,
      targetZones: this._targetZones || {},
      targetsByFaction: this._targetsByFaction
    };
  }

  async close() {
    this._closing = true;
    if (this._actTimer) { clearTimeout(this._actTimer); this._actTimer = null; }
    if (this._chatTimer) { clearTimeout(this._chatTimer); this._chatTimer = null; }
    if (this._consolidateTimer) { clearTimeout(this._consolidateTimer); this._consolidateTimer = null; }
    try { this._socket && this._socket.disconnect(); } catch {}
    this._socket = null;
    this.lastAction = 'closed';
  }
}