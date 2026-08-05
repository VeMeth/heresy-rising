import { openEngineSocket } from './engineSocket.js';
import { BufferWindow, StructuredNotes, RollingSummary } from './memory.js';
import { buildEnginePayload } from './actionDispatch.js';
import { actionValidator } from './validator.js';
import { isNearDuplicate } from './textDedup.js';
import { enqueueLLMCall } from './llm/queue.js';
import { resolveProfile } from './llm/registry.js';
import { recordThought } from './thoughts.js';

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
   * @param {number} [params.costCeilingUsd]
   * @param {object} [params.config]
   * @param {object} [params.llm]
   * @param {string} [params.profileId]
   * @param {string} [params.engineBaseUrl]
   * @param {object} [params.persistence]
   * @param {object} [params.snapshot]
   */
  constructor(params) {
    const { id, conclaveCode, playerCode, name, personaOverrides, costCeiling, costCeilingUsd, config, llm, profileId, engineBaseUrl, persistence, snapshot: snap } = params;
    this.id = id;
    this.playerCode = playerCode || id;
    this.conclaveCode = conclaveCode;
    this.name = name || 'Heretic Bot';
    this._persistence = persistence || null;
    // Resolve the model profile FIRST, before anything else — agent C's
    // prompt-assembly code reads session._profile for budget scaling, and it
    // must be set before any LLM call can possibly happen. A restored
    // snapshot's profile wins over a constructor-passed profileId (a restart
    // must bring a bot back on the profile it was actually spawned with);
    // resolveProfile(undefined) falls back through BOT_DEFAULT_PROFILE to
    // 'local', matching a pre-profile snapshot or a spawn with no `profile`.
    // rest.js already validates the profile before construction, so a throw
    // here in practice only fires for a stale/renamed profile id in an old
    // snapshot — index.js's restore loop already wraps `new BotSession(...)`
    // in try/catch and skips that session, which is the right failure mode.
    this._profile = resolveProfile(snap ? snap.profile : profileId);
    this.profileId = this._profile.id;
    if (snap) {
      // Restore from a previously-saved snapshot.
      this.role = snap.role ?? null;
      this.faction = snap.faction ?? null;
      this.alive = snap.alive ?? true;
      this.phase = snap.phase ?? 'lobby';
      this.round = snap.round ?? 0;
      this.botIds = Array.isArray(snap.botIds) ? snap.botIds : [];
      this.sessionInit = snap.sessionInit ?? null;
      this.personaOverrides = snap.personaOverrides ?? null;
      this.costCeiling = snap.costCeiling ?? (config?.maxTokensPerGame || 50000);
      this.tokensUsed = snap.tokensUsed ?? 0;
      // USD side of the budget gate (plan §3.5). snap.costCeilingUsd carries
      // forward a per-spawn override across a restart; falling back to the
      // resolved profile's default (Infinity for `local`, so the gate below
      // can never fire on cost for a local bot) rather than to `costCeiling`
      // param — a restore doesn't get a fresh constructor override.
      this.costCeilingUsd = snap.costCeilingUsd ?? this._profile.costCeilingUsd;
      this.costUsd = snap.costUsd ?? 0;
      this.reasoningTokens = snap.reasoningTokens ?? 0; // admin visibility only — already inside tokensUsed/costUsd, never billed twice
      this.lastAction = snap.lastAction || 'restored';
      this.startedAt = snap.startedAt ?? Date.now();
      this.shortTermMemory = new BufferWindow({ windowSize: this._profile.memoryWindow });
      if (Array.isArray(snap.shortTermMemory)) {
        for (const item of snap.shortTermMemory) this.shortTermMemory.append(item);
      }
      this.notes = new StructuredNotes({ maxKeys: this._profile.noteKeys });
      if (snap.notes && typeof snap.notes === 'object') {
        for (const [k, v] of Object.entries(snap.notes)) this.notes.set(k, v);
      }
      // Persisted additively — old snapshots without a rollingSummary field
      // load fine (RollingSummary.fromJSON(undefined) -> empty summary).
      this.rollingSummary = RollingSummary.fromJSON(snap.rollingSummary);
      // Same additive pattern for phaseSummaries: pre-phases-summaries
      // snapshots load with an empty array; nothing is dropped or migrated.
      this.phaseSummaries = Array.isArray(snap.phaseSummaries) ? snap.phaseSummaries : [];
      this.deadPlayers = Array.isArray(snap.deadPlayers) ? snap.deadPlayers : [];
      this.lastOwnZone = snap.lastOwnZone ?? null;
      this.actionLog = [];
      this.roundActionStatus = snap.roundActionStatus ?? 'pending';
      this.roundActionDetail = snap.roundActionDetail ?? null;
      this._roundActionKey = null; // force a re-check against live state on next game:state
    } else {
      this.role = null;
      this.faction = null;
      this.alive = true;
      this.phase = 'lobby';
      this.round = 0;
      this.botIds = [];
      this.sessionInit = null;
      this.personaOverrides = personaOverrides || null;
      this.costCeiling = costCeiling || config.maxTokensPerGame;
      // costCeilingUsd is overridable per-spawn the same way costCeiling is;
      // `??` (not `||`) so an explicit 0 override (e.g. a test wanting an
      // immediately-exhausted cloud bot) isn't silently replaced by the
      // profile default.
      this.costCeilingUsd = costCeilingUsd ?? this._profile.costCeilingUsd;
      this.tokensUsed = 0;
      this.costUsd = 0;
      this.reasoningTokens = 0;
      this.lastAction = 'init';
      this.startedAt = Date.now();
      // Memory depth is per-profile: an 8k local model keeps the original
      // 20-event window / 15-key note ledger, while a big-context cloud
      // profile can afford to remember proportionally more of the game
      // (see llm/profiles.js memoryWindow/noteKeys, plan §3.6).
      this.shortTermMemory = new BufferWindow({ windowSize: this._profile.memoryWindow });
      this.notes = new StructuredNotes({ maxKeys: this._profile.noteKeys });
      this.rollingSummary = new RollingSummary();
      // Populated by the director's phase-change tick (only for profiles with
      // `consolidateAtPhaseEnd`); a fresh bot starts empty.
      this.phaseSummaries = [];
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
      alive: this.alive,
      phase: this.phase,
      round: this.round,
      botIds: this.botIds,
      sessionInit: this.sessionInit,
      personaOverrides: this.personaOverrides,
      profile: this.profileId,
      costCeiling: this.costCeiling,
      costCeilingUsd: this.costCeilingUsd,
      tokensUsed: this.tokensUsed,
      costUsd: this.costUsd,
      reasoningTokens: this.reasoningTokens,
      lastAction: this.lastAction,
      startedAt: this.startedAt,
      shortTermMemory: this.shortTermMemory.items,
      notes: this.notes.all(),
      rollingSummary: this.rollingSummary.toJSON(),
      phaseSummaries: this.phaseSummaries,
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
      // profileId only — never this._profile (see plan §3.8: the profile
      // object carries apiKey and must never reach an HTTP response).
      profile: this.profileId,
      tokensUsed: this.tokensUsed,
      costCeiling: this.costCeiling,
      costUsd: this.costUsd,
      costCeilingUsd: this.costCeilingUsd,
      reasoningTokens: this.reasoningTokens,
      startedAt: this.startedAt,
      connected: !!(this._socket && this._socket.connected),
      llmPassive: !!(this._llm && (this._llm.label === 'passthrough' || this._llm._label === 'passthrough')),
      shortTermMemory: this.shortTermMemory.inspect(),
      actionLog: this.actionLog,
      sessionInit: this.sessionInit,
      personaOverrides: this.personaOverrides,
      alivePlayers: this.alivePlayers,
      winner: this.winner,
      // Phase-end memory (the LLM-generated summaries the director's tick
      // appends on every phase transition, for cloud profiles). Surfaced
      // here so the admin panel can see what the bot has actually captured
      // — without this, a bot that "remembers" things across rounds looks
      // identical to a bot with an empty long-term memory.
      phaseSummaries: Array.isArray(this.phaseSummaries) ? this.phaseSummaries : [],
      phaseSummariesCount: Array.isArray(this.phaseSummaries) ? this.phaseSummaries.length : 0
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
    if ('lastProtectTarget' in s) {
      this._lastProtectTarget = s.lastProtectTarget || null;
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
      // prevPhase/prevRound are captured BEFORE the director is notified so
      // the consolidation it's about to schedule can label the just-ended
      // phase correctly. this._lastRound is still the OLD round at this
      // point (it gets reassigned to `this.round` a few lines below), so a
      // night→day transition that bumps `this.round` from N to N+1 still
      // sees the night-phase summary labelled "Round N, night".
      const prevPhase = this._lastPhase;
      const prevRound = this._lastRound;
      this._chatSentThisPhase = 0;
      this._director?.onPhaseChange?.(this.phase, prevPhase, prevRound);
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

  // The server sends authorCode (the APPARENT speaker), never the true
  // player_code — a forged or puppeted message must look to a bot exactly as
  // it looks to a human. The director's anti-flood guard keys off this too,
  // which is correct: a bot's own puppet-speech should not be treated as
  // another bot's turn to reply to.
  _onChatMessage(payload) {
    const m = payload?.message;
    if (!m) return;
    if (m.channel && m.channel !== 'public') return; // public only; faction handled separately (BOT_FACTION_CHAT)
    this.shortTermMemory.append({ kind: 'chat_message', from: m.authorCode, author: m.author, text: m.body, round: this.round, phase: this.phase });
    this._save();
    this._director?.observe({
      id: m.id,
      from: m.authorCode,
      author: m.author,
      isBot: Array.isArray(this.botIds) && this.botIds.includes(m.authorCode),
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
    // Two independent budget gates (plan §3.5): token ceiling (today's
    // MAX_TOKENS_PER_GAME behaviour, unchanged) and a USD ceiling for paid
    // profiles. `local`'s costCeilingUsd is Infinity (see profiles.js), so
    // costUsd (which never accrues for local — usdPerMTokIn/Out are both 0)
    // can never reach it; this branch is dead weight for local bots by
    // construction, not by a special-case check here.
    if (this.tokensUsed >= this.costCeiling) {
      this.lastAction = 'budget_exhausted';
      this._markRoundAction(prompt, 'error', { reason: 'budget_exhausted_tokens' });
      return;
    }
    if (this.costUsd >= this.costCeilingUsd) {
      this.lastAction = 'budget_exhausted';
      this._markRoundAction(prompt, 'error', { reason: 'budget_exhausted_usd' });
      return;
    }
    let action;
    try {
      this._pendingThought = null;
      action = await enqueueLLMCall(() => this._llm.generate({ session: this, prompt }), { lane: this._profile.lane });
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

    // Chat-turn prompts (director-triggered) may emit chat, pass, or a
    // revised vote — a bot that hears something persuasive mid-discussion
    // needs a way to act on it before the round's single day_vote_prompt is
    // long past. Night actions are still out of turn here (nights don't run
    // a chat director) and stay forbidden.
    if (prompt?.kind === 'chat_turn' && action.kind === 'night_action') {
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
      this._logAction({ kind: 'pass', note: `already voted for ${this._playerName(action.target)} this round` });
      return;
    }

    const dispatch = buildEnginePayload(action, this);
    if (!dispatch) { this.lastAction = 'invalid_action'; this._logAction({ kind: 'invalid_action', action }); this._markRoundAction(prompt, 'error', { reason: 'invalid_action' }); return; }
    if (dispatch.type === 'pass' || dispatch.type === 'sleep') { this.lastAction = dispatch.type; this._logAction({ kind: dispatch.type, action }); this._markRoundAction(prompt, 'passed'); return; }
    if (!this._socket || !this._socket.connected) { this.lastAction = 'socket_offline'; this._logAction({ kind: 'socket_offline', action }); this._markRoundAction(prompt, 'error', { reason: 'socket_offline' }); return; }

    if (dispatch.type === 'chat' || dispatch.type === 'chat-as') {
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
      const chatEvent = dispatch.type === 'chat-as' ? 'chat:send-as' : 'chat:send';
      this._emit(chatEvent, dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`${chatEvent} rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'chat';
      this._logAction({ kind: 'chat', action, target: dispatch.payload?.target, text: dispatch.payload?.body });
      // A night_action_prompt/day_vote_prompt turn that produced chat instead
      // of the requested action means no real action was submitted — surface
      // that as an error rather than leaving admin looking at a stale 'pending'.
      this._markRoundAction(prompt, 'error', { reason: 'model replied with chat instead of the requested action' });
    } else if (dispatch.type === 'vote' || dispatch.type === 'vote-as') {
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
      const voteEvent = dispatch.type === 'vote-as' ? 'vote:submit-as' : 'vote:submit';
      this._emit(voteEvent, dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`${voteEvent} rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'vote';
      this._lastVoteTarget = dispatch.payload?.targetCode || 'skip';
      this.rollingSummary.addOwnVote(this.round, this._lastVoteTarget, dispatch.payload?.justification);
      this._logAction({ kind: 'vote', action, target: dispatch.payload?.targetCode });
      this._markRoundAction(prompt, 'submitted', { target: dispatch.payload?.targetCode, justification: dispatch.payload?.justification });
    } else if (dispatch.type === 'faction-action') {
      this._emit('action:submit-faction', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`action:submit-faction rejected for ${this.id}: ${ack.error}`);
      });
      this.lastAction = 'action:blood_ritual';
      this.rollingSummary.addOwnNightAction(this.round, 'blood_ritual', dispatch.payload?.targetCode);
      this._logAction({ kind: 'action', verb: 'blood_ritual', action, targetCode: dispatch.payload?.targetCode });
      this._markRoundAction(prompt, 'submitted', { verb: 'blood_ritual', target: dispatch.payload?.targetCode });
    } else if (dispatch.type === 'action') {
      this._emit('action:submit', dispatch.payload, (ack) => {
        if (ack?.ok === false) console.warn(`action:submit rejected for ${this.id}: ${ack.message}`);
      });
      this.lastAction = `action:${action.verb}`;
      this.rollingSummary.addOwnNightAction(this.round, action.verb, dispatch.payload?.targetCode);
      this._logAction({ kind: 'action', verb: action.verb, action, target: dispatch.payload?.target, targetCode: dispatch.payload?.targetCode });
      this._markRoundAction(prompt, 'submitted', { verb: action.verb, target: dispatch.payload?.targetCode });
    }
  }

  // Phase-end consolidation, driven by the director's tick loop on a phase
  // transition (only for profiles with `consolidateAtPhaseEnd`). The events
  // argument is a SNAPSHOT of the rolling summary taken at the moment the
  // director scheduled the consolidation, not a live view — without the
  // snapshot, events that arrive over the next few seconds while the
  // consolidation sits in the queue would leak into the summary of the
  // phase that just ended.
  //
  // Same budget gates as _act() so a session that's already exhausted its
  // USD/token ceiling cannot get a paid call it can't afford. The whole
  // thing is fire-and-forget from the director's perspective — the
  // director awaits this, but a thrown error is logged and swallowed here
  // so the director's tick loop doesn't see a rejection cascade.
  async consolidatePhase(prevPhase, prevRound, events) {
    if (this._closing) return;
    if (!this._profile?.consolidateAtPhaseEnd) return;
    const lines = Array.isArray(events) ? events : this.rollingSummary.lines;
    if (!lines.length) return;
    if (this.tokensUsed >= this.costCeiling) {
      this.lastAction = 'budget_exhausted';
      return;
    }
    if (this.costUsd >= this.costCeilingUsd) {
      this.lastAction = 'budget_exhausted';
      return;
    }
    try {
      const result = await enqueueLLMCall(
        () => this._llm.consolidate({ session: this, phase: prevPhase, round: prevRound, events: lines }),
        { lane: this._profile.lane }
      );
      if (result?.summary) {
        this.phaseSummaries.push({ phase: prevPhase, round: prevRound, summary: result.summary, ts: Date.now() });
        this._save();
      }
    } catch (e) {
      console.warn(`[bot-manager] consolidation failed for ${this.id}:`, e.message);
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
    // Attach the LLM reasoning captured during this turn (set by
    // actionLLM.js on a successful parse) to the single feed entry that
    // _recordThought emits for this turn — one entry per action, carrying
    // its own reasoning inline, instead of a separate 'thinking' entry
    // immediately followed by the matching 'action' entry. _logAction is
    // the single funnel for every _act() outcome, so this is the right
    // place to fold it in and clear it.
    if (this._pendingThought) {
      if (entry.thought === undefined) entry.thought = this._pendingThought.thought;
      if (entry.attempt === undefined) entry.attempt = this._pendingThought.attempt;
      this._pendingThought = null;
    }
    this.actionLog.push({ ts: Date.now(), phase: this.phase, round: this.round, ...entry });
    // Cap the log to the last 50 entries
    if (this.actionLog.length > 50) this.actionLog.splice(0, this.actionLog.length - 50);
    this._recordThought(entry);
  }

  // Resolve a playerCode to a display name using the latest public roster
  // we observed (playerNames map, built in _onGameState). Falls back to the
  // raw code if we never heard of it — better to show an opaque code than
  // nothing, and avoids leaking the fact that we couldn't resolve it.
  _playerName(code) {
    if (!code) return code;
    return (this.playerNames && this.playerNames[code]) || code;
  }

  // Mirrors every _act() outcome into the cross-bot thoughts feed
  // (BOT_THOUGHTS_FEED_PLAN.md §2.2 item 2). _logAction is already the
  // single funnel for chat/vote/action/pass/rejected/suppressed-duplicate/
  // invalid_action/llm_error/socket_offline — this is the one place that
  // mirrors all of them; do NOT scatter recordThought calls elsewhere in
  // _act(). Never allowed to break a bot's turn: recordThought() itself
  // never throws, but this call site is wrapped defensively anyway since it
  // runs on every single outcome of every turn.
  _recordThought(entry) {
    try {
      recordThought({
        conclaveCode: this.conclaveCode,
        botId: this.id,
        playerCode: this.playerCode,
        botName: this.name,
        profileId: this.profileId,
        role: this.role,
        faction: this.faction,
        round: this.round,
        phase: this.phase,
        kind: feedKindForLogEntry(entry),
        summary: feedSummaryForLogEntry(entry, this.playerNames),
        thought: entry?.thought,
        detail: feedDetailForLogEntry(entry)
      });
    } catch { /* observability must never break a bot's turn */ }
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
      lastProtectTarget: this._lastProtectTarget || null,
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

// --- _logAction -> thoughts feed mapping (BOT_THOUGHTS_FEED_PLAN.md §2.2) --
//
// _logAction's `entry.kind` is the internal actionLog vocabulary (chat, vote,
// action, pass, sleep, rejected, invalid_action, llm_error, socket_offline —
// see every _logAction() call site in _act() above). The feed only has six
// kinds; these three helpers do the one-time mapping so _recordThought stays
// a thin dispatcher.

function truncateExcerpt(str, n = 80) {
  if (typeof str !== 'string' || !str) return '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// Resolve a playerCode → display name using the public roster the session
// observed (playerNames map; see _onGameState). Falls back to the raw code
// when no name is known — better an opaque code than a silent drop.
function resolveName(playerNames, code) {
  if (!code) return code;
  const n = playerNames && playerNames[code];
  return n || code;
}

function feedKindForLogEntry(entry) {
  if (entry?.kind === 'rejected') return 'rejected';
  if (entry?.kind === 'llm_error' || entry?.kind === 'socket_offline' || entry?.kind === 'invalid_action') return 'error';
  // A `pass` carrying a note is NOT the model choosing to stay quiet — it is
  // us blocking something the model actually produced. There are three such
  // guards in _act(), and an operator reading the feed needs all three to
  // look different from a genuine pass, otherwise "the bot said nothing"
  // hides "the bot tried to speak and we stopped it":
  //   - 'suppressed near-duplicate chat'   (textDedup guard)
  //   - 'already voted for X this round'   (re-vote guard)
  //   - 'chat_turn cannot emit vote|night_action' (out-of-turn guard)
  // Any noted pass is therefore a suppression; a bare pass stays an action.
  // Keyed on the presence of a note rather than on matching each string, so a
  // future fourth guard is classified correctly without touching this.
  if (entry?.kind === 'pass' && typeof entry.note === 'string' && entry.note.trim()) return 'suppressed';
  return 'action';
}

function feedSummaryForLogEntry(entry, playerNames) {
  switch (entry?.kind) {
    case 'chat':
      return `chatted — "${truncateExcerpt(entry.text)}"`;
    case 'vote': {
      const target = entry.target || 'skip';
      const targetLabel = target === 'skip' ? 'skip' : resolveName(playerNames, target);
      const justification = entry.action?.justification;
      return justification ? `voted ${targetLabel} — "${truncateExcerpt(justification)}"` : `voted ${targetLabel}`;
    }
    case 'action': {
      const target = entry.targetCode || entry.target;
      const targetLabel = target ? resolveName(playerNames, target) : null;
      return targetLabel ? `${entry.verb || 'acted'} → ${targetLabel}` : (entry.verb || 'acted');
    }
    case 'rejected':
      return `rejected — ${entry.reason || 'unknown reason'}`;
    case 'invalid_action':
      return 'error — invalid action';
    case 'llm_error':
      return `error — ${entry.error || 'llm error'}`;
    case 'socket_offline':
      return 'error — socket offline';
    case 'pass':
    case 'sleep':
      return entry.note ? `passed — ${entry.note}` : 'passed';
    default:
      return entry?.kind || 'unknown';
  }
}

function feedDetailForLogEntry(entry) {
  return {
    verb: entry?.verb,
    target: entry?.target,
    targetCode: entry?.targetCode,
    reason: entry?.reason,
    note: entry?.note,
    text: entry?.text,
    error: entry?.error,
    attempt: entry?.attempt
  };
}
