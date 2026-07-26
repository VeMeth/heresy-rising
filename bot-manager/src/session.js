import { openEngineSocket } from './engineSocket.js';
import { BufferWindow, StructuredNotes, RollingSummary } from './memory.js';
import { buildEnginePayload } from './actionDispatch.js';
import { actionValidator } from './validator.js';
import { isNearDuplicate } from './textDedup.js';
import { enqueueLLMCall } from './llm/queue.js';

// Phase 3 wires the engine Socket.IO client + the decision loop against a
// pluggable `llm` (OpenAIChat / MockChatLLM via ActionLLM). Until configured,
// a PassThroughLLM makes the bot observe silently (PASSIVE mode).
//
// Chat is no longer per-bot reactive/debounced: a single ConversationDirector
// per conclave (director.js, registered via sessionStore.add()) decides which
// bot speaks and calls session.takeChatTurn(). Engine-driven night/vote
// prompts still flow through _scheduleAct -> _act as before.
export class BotSession {
  /**
   * @param {object} params
   * @param {string} params.id
   * @param {string} [params.conclaveCode]
   * @param {string} [params.playerCode]
   * @param {string} [params.name]
   * @param {object} [params.personaOverrides]
   * @param {number} [params.costCeiling]
   * @param {object} [params.config]
   * @param {object} [params.llm]
   * @param {string} [params.engineBaseUrl]
   * @param {object} [params.persistence]
   * @param {object} [params.snapshot]
   */
  constructor(params) {
    const { id, conclaveCode, playerCode, name, personaOverrides, costCeiling, config, llm, engineBaseUrl, persistence, snapshot: snap } = params;
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
      // Persisted additively — old snapshots without a rollingSummary field
      // load fine (RollingSummary.fromJSON(undefined) -> empty summary).
      this.rollingSummary = RollingSummary.fromJSON(snap.rollingSummary);
      this.deadPlayers = Array.isArray(snap.deadPlayers) ? snap.deadPlayers : [];
      this.lastOwnZone = snap.lastOwnZone ?? null;
      this.actionLog = [];
      this.roundActionStatus = snap.roundActionStatus ?? 'pending';
      this.roundActionDetail = snap.roundActionDetail ?? null;
      this._roundActionKey = null; // force a re-check against live state on next game:state
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
      this.rollingSummary = new RollingSummary();
      this.deadPlayers = [];
      this.lastOwnZone = null;
      this.actionLog = [];
      this.roundActionStatus = 'pending';
      this.roundActionDetail = null;
      this._roundActionKey = null;
    }
    this._config = config;
    this._llm = llm || { async generate() { return { kind: 'pass' }; }, label: 'passthrough' };
    this._engineBaseUrl = engineBaseUrl;
    this._socket = null;
    this._joinPromise = null;
    this._actTimer = null;
    this._closing = false;
    this._director = null; // set by SessionStore.add()
    // Per-bot random stagger so simultaneously-spawned bots don't all hit the
    // LLM at once. Capped small (~3s) — with local inference, the request
    // latency itself already provides natural pacing between bots serialized
    // through llm/queue.js.
    this._actJitterMs = Math.floor(Math.random() * 3000);
    this.connect();
  }

  /** Serialise session state to a plain object for persistence. */
  snapshot() {
    return {
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
      notes: this.notes.all(),
      rollingSummary: this.rollingSummary.toJSON(),
      deadPlayers: this.deadPlayers,
      lastOwnZone: this.lastOwnZone,
      roundActionStatus: this.roundActionStatus,
      roundActionDetail: this.roundActionDetail
    };
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
      roundActionStatus: this.roundActionStatus,
      roundActionDetail: this.roundActionDetail,
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
    // Track whether this bot has submitted its action for the CURRENT
    // phase+round — a clear, non-clobbered signal for admin visibility
    // ("did they act at night?"), independent of the noisy `lastAction`
    // string below, which gets overwritten by every routine state tick.
    const roundKey = `${this.phase}:${this.round}`;
    if (this._roundActionKey !== roundKey) {
      this._roundActionKey = roundKey;
      if (this.phase === 'night') this.roundActionStatus = 'pending';
      else if (this.phase === 'day') this.roundActionStatus = this.round === 1 ? 'n/a' : 'pending'; // Day 1 is chat-only, no vote
      else this.roundActionStatus = 'n/a'; // lobby / ended
      this.roundActionDetail = null;
    }
    if (s.me) {
      this.alive = !!s.me.alive;
      if (s.me.role && typeof s.me.role === 'object') this.role = s.me.role.id || this.role;
      else if (typeof s.me.role === 'string') this.role = s.me.role;
      if (s.me.faction) this.faction = s.me.faction;
      this._latestMe = s.me;
    }
    if (Array.isArray(s.players)) {
      // Track the codes of all currently-alive/dead players. The bot is
      // drift-blind — it only sees codes from the public roster, never drift
      // values or zones.
      this.alivePlayers = s.players.filter((p) => p.alive).map((p) => p.playerCode);
      this.deadPlayers = s.players.filter((p) => !p.alive).map((p) => p.playerCode);
      // Build a name->code map so the bot can refer to players by name in chat.
      this.playerNames = {};
      for (const p of s.players) {
        if (p.name && p.playerCode) this.playerNames[p.playerCode] = p.name;
      }
      // other-bot visibility already comes through bot:session_init
    }
    if (this._lastPhase && this._lastPhase !== this.phase) {
      // Phase changed — reset phase-scoped counters and notify the director.
      this._chatSentThisPhase = 0;
      this._director?.onPhaseChange(this.phase);
    }
    // Reset per-round vote tracking on round change.
    if (this._lastRound !== this.round) {
      this._lastVoteTarget = null;
      this._lastRound = this.round;
    }
    this._lastPhase = this.phase;
    if (Array.isArray(s.privateMessages) && s.privateMessages.length) {
      for (const m of s.privateMessages) {
        if (!m.meta) continue;
        if (m.meta.ownZone) this.lastOwnZone = m.meta.ownZone;
        if (m.meta.intelKind || m.meta.drift_hint) {
          this.shortTermMemory.append({ kind: 'intel_return', ...m.meta, round: this.round });
          this.rollingSummary.addIntelReturn(this.round, summarizeIntel(m.meta));
        }
      }
    }
    if (this.lastAction !== 'killed' && this.lastAction !== 'game_over') this.lastAction = `state:${this.phase}`;
    this._save();
  }

  _onChatMessage(payload) {
    const m = payload?.message;
    if (!m) return;
    if (m.channel && m.channel !== 'public') return; // public only; faction handled separately (BOT_FACTION_CHAT)
    this.shortTermMemory.append({ kind: 'chat_message', from: m.player_code, author: m.author, text: m.body, round: this.round, phase: this.phase });
    this._save();
    this._director?.observe({
      id: m.id,
      from: m.player_code,
      author: m.author,
      isBot: Array.isArray(this.botIds) && this.botIds.includes(m.player_code),
      text: m.body,
      round: this.round
    });
  }

  _onAnnouncement(payload) {
    const a = payload?.announcement;
    if (!a) return;
    this.shortTermMemory.append({ kind: 'announcement', type: a.type, title: a.title, message: a.message });
    this.rollingSummary.addAnnouncement(a, this.round);
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

  // Called by the ConversationDirector when it picks this bot to speak.
  async takeChatTurn(reason) {
    return this._act({ kind: 'chat_turn', reason });
  }

  // Records the outcome of an engine-driven night_action_prompt / day_vote_prompt
  // against the CURRENT round+phase — the clear, non-clobbered signal admin
  // tooling reads to answer "did this bot act?" (see roundActionStatus reset
  // in _onGameState). No-op for chat_turn prompts, which aren't round actions.
  _markRoundAction(prompt, status, detail = null) {
    if (prompt?.kind !== 'night_action_prompt' && prompt?.kind !== 'day_vote_prompt') return;
    this.roundActionStatus = status;
    this.roundActionDetail = detail;
  }

  async _act(prompt) {
    if (!this.alive || this._closing) return;
    if (this.tokensUsed >= this.costCeiling) {
      this.lastAction = 'budget_exhausted';
      this._markRoundAction(prompt, 'error', { reason: 'budget_exhausted' });
      return;
    }
    let action;
    try {
      action = await enqueueLLMCall(() => this._llm.generate({ session: this, prompt }));
    } catch (e) {
      console.warn(`[bot-manager] LLM generate failed for ${this.id}:`, e.message);
      this.lastAction = 'llm_error';
      this._logAction({ kind: 'llm_error', error: e.message });
      this._markRoundAction(prompt, 'error', { reason: e.message });
      return;
    }
    if (!action) { this.lastAction = 'pass'; this._logAction({ kind: 'pass' }); this._markRoundAction(prompt, 'passed'); return; }

    // Forward any notes the bot wants to persist into its structured memory.
    // Notes are write-only side effects — apply them even on `pass` so the bot
    // can record observations without taking an action this turn.
    if (action.notes && typeof action.notes === 'object') {
      for (const [k, v] of Object.entries(action.notes)) this.notes.set(k, v);
    }

    this._save();
    if (action.kind === 'pass') { this.lastAction = 'pass'; this._logAction({ kind: 'pass' }); this._markRoundAction(prompt, 'passed'); return; }

    // Chat-turn prompts (director-triggered) may only emit chat (or pass).
    // Forbid votes and night actions here so a chat turn cannot double-cast a
    // vote or trigger a night action out of turn.
    if (prompt?.kind === 'chat_turn' && (action.kind === 'vote' || action.kind === 'night_action')) {
      this.lastAction = 'pass';
      this._logAction({ kind: 'pass', note: `chat_turn cannot emit ${action.kind}` });
      return;
    }

    // Soft pre-validation. Engine is still the source of truth — but if our
    // validator catches an obvious violation (self-target, day-1 vote, etc.)
    // we downgrade to pass rather than waste a round-trip on a rejected
    // action.
    const validation = actionValidator(this.role, action, this._validatorContext());
    if (!validation.ok) {
      console.warn(`[bot-manager] validator rejected action for ${this.id} (${this.role}): ${validation.reason}`);
      this.lastAction = `rejected:${validation.reason}`;
      this._logAction({ kind: 'rejected', action, reason: validation.reason });
      this._markRoundAction(prompt, 'rejected', { reason: validation.reason });
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
    if (!dispatch) { this.lastAction = 'invalid_action'; this._logAction({ kind: 'invalid_action', action }); this._markRoundAction(prompt, 'error', { reason: 'invalid_action' }); return; }
    if (dispatch.type === 'pass' || dispatch.type === 'sleep') { this.lastAction = dispatch.type; this._logAction({ kind: dispatch.type, action }); this._markRoundAction(prompt, 'passed'); return; }
    if (!this._socket || !this._socket.connected) { this.lastAction = 'socket_offline'; this._logAction({ kind: 'socket_offline', action }); this._markRoundAction(prompt, 'error', { reason: 'socket_offline' }); return; }

    if (dispatch.type === 'chat') {
      // Small local models regenerate near-identical chat lines — the same
      // bot restating itself once the provoking message scrolls out of
      // context, or a different bot echoing another bot's exact phrasing.
      // Check against this bot's own history AND the shared conclave feed
      // before sending; a duplicate is suppressed as a pass rather than
      // flooding chat with restated (sometimes stale or factually wrong,
      // e.g. copying another bot's role self-claim) text.
      const dupSources = [...this._recentOwnTexts(), ...(this._director?.recentTexts() || [])];
      if (isNearDuplicate(dispatch.payload?.body, dupSources)) {
        this.lastAction = 'pass';
        this._logAction({ kind: 'pass', note: 'suppressed near-duplicate chat', text: dispatch.payload?.body });
        return;
      }
      this._chatSentThisPhase = (this._chatSentThisPhase || 0) + 1;
      this._emit('chat:send', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`chat:send rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'chat';
      this._logAction({ kind: 'chat', action, target: dispatch.payload?.target, text: dispatch.payload?.body });
      // A night_action_prompt/day_vote_prompt turn that produced chat instead
      // of the requested action means no real action was submitted — surface
      // that as an error rather than leaving admin looking at a stale 'pending'.
      this._markRoundAction(prompt, 'error', { reason: 'model replied with chat instead of the requested action' });
    } else if (dispatch.type === 'vote') {
      // Same anti-duplicate check applied to the justification only — the
      // vote itself always counts (dropping it over duplicate flavor text
      // would be worse than the duplication). Only strip when safe: a
      // crippled bot (tier>=2) that's required to justify every vote keeps
      // whatever it generated rather than risk the engine rejecting the
      // vote for a missing justification.
      const crippled = (this._latestMe?.crippleTier ?? 0) >= 2;
      if (!crippled && dispatch.payload?.justification) {
        const dupSources = [...this._recentOwnTexts(), ...(this._director?.recentTexts() || [])];
        if (isNearDuplicate(dispatch.payload.justification, dupSources)) dispatch.payload.justification = '';
      }
      this._emit('vote:submit', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`vote:submit rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'vote';
      this._lastVoteTarget = dispatch.payload?.targetCode || 'skip';
      this.rollingSummary.addOwnVote(this.round, this._lastVoteTarget, dispatch.payload?.justification);
      this._logAction({ kind: 'vote', action, target: dispatch.payload?.targetCode });
      this._markRoundAction(prompt, 'submitted', { target: dispatch.payload?.targetCode, justification: dispatch.payload?.justification });
    } else if (dispatch.type === 'action') {
      this._emit('action:submit', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`action:submit rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = `action:${action.verb}`;
      this.rollingSummary.addOwnNightAction(this.round, action.verb, dispatch.payload?.targetCode);
      this._logAction({ kind: 'action', verb: action.verb, action, target: dispatch.payload?.target, targetCode: dispatch.payload?.targetCode });
      this._markRoundAction(prompt, 'submitted', { verb: action.verb, target: dispatch.payload?.targetCode });
    }
  }

  // Own past chat lines + vote justifications, for the anti-duplicate check
  // in _act() — catches same-bot repetition across rounds after the
  // provoking chat has scrolled out of the shared director feed.
  _recentOwnTexts(n = 20) {
    const out = [];
    for (const entry of this.actionLog.slice(-n)) {
      if (entry.kind === 'chat' && entry.text) out.push(entry.text);
      else if (entry.kind === 'vote' && entry.action?.justification) out.push(entry.action.justification);
    }
    return out;
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
      // No signal today: the bot-manager doesn't track per-target drift
      // zones or faction rosters client-side, so the validator is
      // drift-blind here (see validator.js's H1/H6 gate comments).
      targetZones: {},
      targetsByFaction: undefined
    };
  }

  async close() {
    this._closing = true;
    if (this._actTimer) { clearTimeout(this._actTimer); this._actTimer = null; }
    try { this._socket && this._socket.disconnect(); } catch {}
    this._socket = null;
    this.lastAction = 'closed';
  }
}

// Renders a private intel-return meta payload as one compact line for the
// RollingSummary. Meta shapes vary by role (zone/result/faction fields); we
// fall back to a capped JSON dump for anything unrecognised.
function summarizeIntel(meta) {
  const bits = [];
  if (meta.intelKind) bits.push(meta.intelKind);
  if (meta.zone) bits.push(`zone=${meta.zone}`);
  if (meta.result) bits.push(`result=${meta.result}`);
  if (meta.faction) bits.push(`faction=${meta.faction}`);
  if (meta.ownZone) bits.push(`ownZone=${meta.ownZone}`);
  if (bits.length) return bits.join(' ');
  return JSON.stringify(meta).slice(0, 160);
}
