/**
 * trace.js — reconstruct a station-by-station account of one resolve() call.
 *
 * THE PROBLEM
 * -----------
 * `HeresyGameManager.resolveNight()` (heresyGameManager.js:782-889) walks 15
 * stations and emits nothing that says "I am now at station 8". There is no
 * instrumentation and we refuse to add any — the engine must stay untouched.
 * So this module rebuilds the account from four observable side channels:
 *
 *   1. changeDrift events (:1278). THE BACKBONE. Every call writes an
 *      hr_events row {playerCode, delta, before, after, reason, zone, round,
 *      phase} UNCONDITIONALLY — even when delta === 0 and even when the value
 *      clamps. So the drift stream is a complete log of every changeDrift call
 *      site that executed, and the ABSENCE of a row is hard evidence a branch
 *      did not run. Several inferences below (the Warp Litany gate above all)
 *      are sound only because of this.
 *   2. Other hr_events rows: night-action, blood-ritual (carries an explicit
 *      `landed` boolean — station 9 is the only attack station that
 *      self-reports), plague-cripple, day-resolution.
 *   3. The four synchronous listener hooks (:300-312).
 *   4. A before/after diff of hr_players / hr_games — the source of truth.
 *
 * THE HONESTY CONTRACT
 * --------------------
 * Not everything is observable. Every fact carries a CONFIDENCE level, and a
 * developer reading the trace must never mistake a re-derivation for a
 * measurement. `derived-rule` means we re-implemented engine precedence and
 * could therefore drift from it; those sites are cross-checked against the row
 * diff, and a disagreement flips integrity.ok rather than being papered over.
 * The trace may be wrong about WHY. It must never silently contradict WHAT.
 */

import {
  NIGHT_STATIONS, DAY_STATIONS, KIND_TO_STATION, REASON_TO_STATION,
  KILL_PRECEDENCE, INTEL_KIND, VERDICTS, CONFIDENCE,
  ENGINE_CONTRACT, computeEngineContractHash,
} from './stations.js';
import { driftZone } from '../../heresy-server/src/mechanics/drift.js';
import { effectiveCrippleTier } from '../../heresy-server/src/mechanics/interrogation.js';

export { NIGHT_STATIONS, DAY_STATIONS, VERDICTS, CONFIDENCE };

/** Night kinds a crippled actor may submit that are accepted but never persisted. */
const SILENT_KINDS = new Set(['protect', 'bodyguard', 'drift-hint', 'warp-read']);

/** Repo root, for the engine contract hash. */
const REPO_ROOT = new URL('../../', import.meta.url).pathname;

/**
 * One probe per manager, forever.
 *
 * The engine's listener arrays are PUSH-ONLY — there is no offAnnouncement()
 * (:300-312). Registering a listener per capture would leak one per call and
 * re-deliver every event to every stale closure. So we register exactly once
 * and route into a swappable `sink` slot that captureCall opens and closes.
 * @type {WeakMap<object, TraceProbe>}
 */
const PROBES = new WeakMap();

/**
 * @typedef {Object} TraceProbe
 * @property {Array|null} sink - open capture buffer, or null when idle
 * @property {object|null} rngRecorder
 * @property {() => void} detach
 */

/**
 * Install the capture probe on a manager. Idempotent: calling twice returns
 * the same probe rather than double-registering.
 *
 * @param {object} manager
 * @param {{rngRecorder?: object}} [opts]
 * @returns {TraceProbe}
 */
export function attachTraceProbe(manager, opts = {}) {
  const existing = PROBES.get(manager);
  if (existing) {
    if (opts.rngRecorder) existing.rngRecorder = opts.rngRecorder;
    return existing;
  }

  /** @type {TraceProbe} */
  const probe = { sink: null, rngRecorder: opts.rngRecorder || null, detach: () => {} };

  // hr_events and hr_messages are separate AUTOINCREMENT sequences, and
  // created_at is this.now() — which the playground FREEZES. So timestamps
  // cannot interleave them, and there is an onChatMessage hook but no
  // onEvent hook. Fix: a reversible instance-level decorator. resolveNight
  // calls `this.event(...)`, so this own-property shadows the prototype
  // method. No engine file is touched and it can be removed.
  const proto = Object.getPrototypeOf(manager);
  const protoEvent = proto.event;
  manager.event = function decoratedEvent(c, t, p) {
    if (probe.sink) probe.sink.push({ src: 'event', type: t, payload: p, code: c });
    return protoEvent.call(this, c, t, p);
  };

  manager.onChatMessage((c, m) => {
    if (probe.sink) probe.sink.push({ src: 'message', code: c, message: m });
  });
  manager.onAnnouncement((c, a) => {
    // emitAnnouncement (:301) stamps a.createdAt with a BARE `new Date()`,
    // not the injected clock. Left in, two traces of identical scenarios
    // would never compare equal — so it never enters the stream.
    if (probe.sink) {
      const { createdAt: _wallClock, ...rest } = a;
      probe.sink.push({ src: 'announcement', code: c, payload: rest });
    }
  });
  manager.onBookmark((c, ownerCode, bookmark) => {
    if (probe.sink) probe.sink.push({ src: 'bookmark', code: c, ownerCode, row: bookmark });
  });
  manager.onBotPrompt((c, payload) => {
    if (probe.sink) probe.sink.push({ src: 'botPrompt', code: c, payload });
  });

  probe.detach = () => { delete manager.event; probe.sink = null; };
  PROBES.set(manager, probe);
  return probe;
}

/** Snapshot every row we diff against. */
function readState(manager, code) {
  const db = manager.db;
  const game = db.prepare('SELECT * FROM hr_games WHERE code=?').get(code);
  const players = db.prepare('SELECT * FROM hr_players WHERE game_code=? ORDER BY seat').all(code);
  const usage = db.prepare('SELECT player_code, ability, uses FROM hr_usage WHERE game_code=?').all(code);
  const maxEvent = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM hr_events WHERE game_code=?').get(code).m;
  const maxMessage = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM hr_messages WHERE game_code=?').get(code).m;
  return { game, players, usage, maxEvent, maxMessage };
}

function byCode(players) {
  const m = new Map();
  for (const p of players) m.set(p.player_code, p);
  return m;
}

/**
 * The generic capture primitive.
 *
 * @param {object} manager
 * @param {string} code
 * @param {(m:object) => any} fn MUST be synchronous — the engine is, and an
 *   await would let a concurrent request bleed into this capture's sink.
 * @param {{label?:string, rngRecorder?:object}} [opts]
 * @returns {object} Trace
 */
export function captureCall(manager, code, fn, opts = {}) {
  if (typeof fn !== 'function') throw new Error('captureCall requires a function');
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    throw new Error('captureCall requires a synchronous function — an await would let another operation bleed into this capture');
  }

  const probe = attachTraceProbe(manager, opts);
  if (probe.sink) throw new Error('A capture is already open on this manager (re-entrancy)');

  const before = readState(manager, code);
  const round = before.game.round;
  const phaseResolved = before.game.phase;
  // hr_actions rows for the round being resolved. Read BEFORE, because a
  // resolution advances the round and we want what was actually submitted.
  const submitted = manager.db
    .prepare('SELECT * FROM hr_actions WHERE game_code=? AND round=? ORDER BY created_at, actor_code')
    .all(code, round);

  // Interleave RNG draws into the stream. `random` was captured at
  // construction as `() => rng.next()`, which resolves `.next` at CALL time —
  // so wrapping the method here is enough. This turns stochastic outcomes
  // (intel noise, the Astropath T1 pick, the plague coin flip) from
  // unobservable into observed.
  const rng = probe.rngRecorder;
  const originalNext = rng ? rng.next : null;
  if (rng) {
    rng.next = function tracedNext() {
      const value = originalNext.call(rng);
      if (probe.sink) probe.sink.push({ src: 'rng', value, drawIndex: rng.draws.length - 1 });
      return value;
    };
  }

  const sink = [];
  probe.sink = sink;
  const startedAt = Date.now();
  let returned;
  try {
    returned = fn(manager);
  } finally {
    probe.sink = null;
    if (rng) rng.next = originalNext;
  }
  const durationMs = Date.now() - startedAt;

  const after = readState(manager, code);
  const newEvents = manager.db
    .prepare('SELECT * FROM hr_events WHERE game_code=? AND id>? ORDER BY id').all(code, before.maxEvent);
  const newMessages = manager.db
    .prepare('SELECT id FROM hr_messages WHERE game_code=? AND id>? ORDER BY id').all(code, before.maxMessage);

  const trace = build({
    label: opts.label || 'capture',
    code, round, phaseResolved, before, after, submitted, sink,
    newEvents, newMessages, durationMs, manager, returned,
  });
  trace.integrity = verify(trace, { newEvents });
  return trace;
}

/** Capture a forced resolution of the current phase. */
export function captureResolution(manager, code, opts = {}) {
  return captureCall(manager, code, (m) => m.resolve(code, true), { label: 'resolve', ...opts });
}

// ── classification ─────────────────────────────────────────────────────────

/**
 * Assign a station + confidence to one raw artifact.
 *
 * `hr_actions` has PK (game_code, round, actor_code) — ONE action per actor
 * per round — so `actorCode -> kind -> station` is a total function. That is
 * what lets most ambiguity resolve as `derived-input` rather than guesswork.
 *
 * @param {object} artifact
 * @param {object} ctx {actionByActor: Map, lastDeathStation: number|null, isNight: boolean}
 * @returns {{station: number|string|null, confidence: string, why: string}}
 */
export function classify(artifact, ctx) {
  const { actionByActor } = ctx;

  if (artifact.src === 'event') {
    const { type, payload } = artifact;

    if (type === 'drift') {
      const reason = payload.reason;
      const mapped = REASON_TO_STATION[reason];

      if (reason === 'night-action') {
        // Station 1 explicitly EXCLUDES kill/blood-ritual/possess/sermon/
        // corrupt-sermon (:788); those pay at their own stations.
        const kind = actionByActor.get(payload.playerCode)?.kind;
        if (kind === 'kill') return { station: 8, confidence: CONFIDENCE.DERIVED_INPUT, why: 'actor submitted a kill; station 1 excludes kills (:788)' };
        if (kind === 'blood-ritual') return { station: 9, confidence: CONFIDENCE.DERIVED_INPUT, why: 'actor submitted a blood ritual' };
        return { station: 1, confidence: CONFIDENCE.DERIVED_INPUT, why: 'flat/scaled night-action cost at station 1' };
      }

      if (reason === 'trap') {
        // trapBlocks() charges the ACTOR, so the drift row's playerCode names
        // the trapped actor and their action kind names the station.
        const kind = actionByActor.get(payload.playerCode)?.kind;
        const st = kind ? KIND_TO_STATION[kind] : null;
        return {
          station: st ?? 0,
          confidence: CONFIDENCE.DERIVED_INPUT,
          why: kind ? `trap drift charged to the actor of a ${kind}` : 'trap drift with no matching action row',
        };
      }

      if (reason === 'witnessed-violence') {
        // THE one case where emission order is load-bearing: this batch is not
        // actor-keyed. The engine emits it inside the same tight loop as the
        // death that caused it, so the death immediately preceding in the
        // stream is the cause. Corroborated by the batch iterating survivors
        // AFTER the death, so successive batches shrink.
        return {
          station: ctx.lastDeathStation ?? (ctx.isNight ? 8 : 'D3'),
          confidence: CONFIDENCE.DERIVED_RULE,
          why: 'attributed to the death immediately preceding it in emission order',
        };
      }

      return {
        station: mapped === 'ambiguous' ? null : (mapped ?? null),
        confidence: CONFIDENCE.OBSERVED,
        why: `changeDrift reason "${reason}"`,
      };
    }

    if (type === 'night-action') {
      if (String(payload.kind).startsWith('poxwalker')) return { station: 4, confidence: CONFIDENCE.OBSERVED, why: 'poxwalker:infect event' };
      if (String(payload.kind).startsWith('murderer')) return { station: 8, confidence: CONFIDENCE.OBSERVED, why: 'murderer:kill-gated event' };
      return { station: null, confidence: CONFIDENCE.OBSERVED, why: `night-action event ${payload.kind}` };
    }
    if (type === 'blood-ritual') return { station: 9, confidence: CONFIDENCE.OBSERVED, why: 'blood-ritual event carries an explicit landed flag' };
    if (type === 'plague-cripple') return { station: 11, confidence: CONFIDENCE.OBSERVED, why: 'plague-cripple event' };
    if (type === 'day-resolution') {
      const outcome = payload.outcome;
      const st = outcome === 'torture' ? 'D2' : outcome === 'lynch' ? 'D3' : 'D1';
      return { station: st, confidence: CONFIDENCE.OBSERVED, why: `day-resolution outcome=${outcome}` };
    }
    return { station: null, confidence: CONFIDENCE.OBSERVED, why: `event ${type}` };
  }

  if (artifact.src === 'message') {
    const meta = artifact.message?.meta
      ? (typeof artifact.message.meta === 'string' ? safeJson(artifact.message.meta) : artifact.message.meta)
      : null;
    const kind = meta?.intelKind;
    if (kind === INTEL_KIND.SCAN || kind === INTEL_KIND.WARP_READ || kind === INTEL_KIND.INTERROGATE) {
      return { station: 6, confidence: CONFIDENCE.OBSERVED, why: `intel message (${kind})` };
    }
    if (kind === INTEL_KIND.EXECUTE_ON_SIGHT) return { station: 6, confidence: CONFIDENCE.OBSERVED, why: 'execute-on-sight intel' };
    if (kind === INTEL_KIND.MURDERER_KILL_GATED) return { station: 8, confidence: CONFIDENCE.OBSERVED, why: 'murderer gate cue' };
    if (kind === INTEL_KIND.ANIMUS_POSSESS) return { station: 10, confidence: CONFIDENCE.OBSERVED, why: 'animus possess result' };
    if (kind === INTEL_KIND.ZONE_CUE) {
      // NB: 'drift_hint' (underscore) is the zone-crossing cue from
      // changeDrift — NOT the Novice Psychic's 'drift-hint' scan. One
      // character apart; see INTEL_KIND in stations.js.
      return { station: ctx.currentStation, confidence: CONFIDENCE.DERIVED_INPUT, why: 'zone-crossing cue, inherits the station of the drift change that caused it' };
    }
    return { station: ctx.currentStation, confidence: CONFIDENCE.DERIVED_RULE, why: 'message attributed by emission position' };
  }

  if (artifact.src === 'announcement') {
    const t = artifact.payload?.type;
    const MAP = {
      execution: 6, kill: 8, 'blood-ritual-cripple': 9,
      'neverborn-reveal': 'D4', 'torture-chamber': 'D2', 'torture-death': 'D2',
      lynch: 'D3', gameover: ctx.isNight ? 14 : 'D6',
    };
    if (t in MAP) return { station: MAP[t], confidence: CONFIDENCE.OBSERVED, why: `${t} announcement` };
    return { station: ctx.currentStation, confidence: CONFIDENCE.DERIVED_RULE, why: `announcement ${t} attributed by position` };
  }

  // BUG FIX: this used to hardcode night bookmarks to station 13 ("Night
  // report") unconditionally. But autoBookmark fires alongside ANY
  // ownAction-flagged private message — interrogation results at station 6,
  // trap-catch notices, kill/blood-ritual confirmations at 8/9, not just the
  // end-of-night action-recap batch — so forcing 13 made a bookmark that was
  // actually emitted at, say, station 6 appear to run AFTER station 8/12
  // artifacts that came later in the real stream, tripping the monotonic-
  // station integrity check on every resolution that had more than one kind
  // of night action. Inheriting the current station (same rule already used
  // for the generic message/announcement fallback below) attributes it to
  // whatever was actually running when it fired, which is both more accurate
  // and monotonic by construction.
  if (artifact.src === 'bookmark') return { station: ctx.currentStation, confidence: CONFIDENCE.OBSERVED, why: 'auto-filed bookmark, inherits the station of whatever private message triggered it' };
  if (artifact.src === 'botPrompt') return { station: ctx.isNight ? 14 : 'D6', confidence: CONFIDENCE.OBSERVED, why: 'bot prompt emitted by setPhase' };
  if (artifact.src === 'rng') return { station: ctx.currentStation, confidence: CONFIDENCE.OBSERVED, why: 'RNG draw' };

  return { station: null, confidence: CONFIDENCE.UNOBSERVABLE, why: 'unrecognised artifact' };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ── assembly ───────────────────────────────────────────────────────────────

function build(input) {
  const {
    label, code, round, phaseResolved, before, after, submitted, sink,
    newEvents, newMessages, durationMs, manager,
  } = input;

  const isNight = phaseResolved === 'night';
  const stationTable = isNight ? NIGHT_STATIONS : DAY_STATIONS;
  const beforeByCode = byCode(before.players);
  const afterByCode = byCode(after.players);

  const actionByActor = new Map();
  for (const a of submitted) actionByActor.set(a.actor_code, a);

  // --- stream -------------------------------------------------------------
  // seq IS the array index, deliberately. The UI's `evidence: [seqIdx]` arrays
  // index straight into stream[], so the two must never diverge.
  const stream = [];
  let currentStation = isNight ? 0 : 'D0';
  let lastDeathStation = null;

  sink.forEach((artifact, i) => {
    const ctx = { actionByActor, lastDeathStation, isNight, currentStation };
    const { station, confidence, why } = classify(artifact, ctx);
    if (station !== null && station !== undefined) currentStation = station;

    // A death announcement re-anchors the witnessed-violence attribution.
    if (artifact.src === 'announcement' && ['kill', 'execution', 'lynch', 'torture-death', 'neverborn-reveal'].includes(artifact.payload?.type)) {
      lastDeathStation = station;
    }

    const entry = { seq: i, src: artifact.src, station: station ?? currentStation, confidence, why };
    if (artifact.src === 'event') { entry.type = artifact.type; entry.payload = artifact.payload; }
    if (artifact.src === 'message') {
      const m = artifact.message || {};
      entry.channel = m.channel; entry.recipientCode = m.recipient_code ?? m.recipientCode ?? null;
      entry.body = m.body; entry.meta = typeof m.meta === 'string' ? safeJson(m.meta) : (m.meta ?? null);
      entry.dbId = m.id;
    }
    if (artifact.src === 'announcement') entry.payload = artifact.payload;
    if (artifact.src === 'bookmark') { entry.ownerCode = artifact.ownerCode; entry.row = artifact.row; }
    if (artifact.src === 'botPrompt') entry.payload = artifact.payload;
    if (artifact.src === 'rng') { entry.value = artifact.value; entry.drawIndex = artifact.drawIndex; }
    stream.push(entry);
  });

  // --- diff ---------------------------------------------------------------
  const playerDiff = {};
  for (const [pc, aRow] of afterByCode) {
    const bRow = beforeByCode.get(pc);
    if (!bRow) continue;
    const changed = {};
    for (const col of Object.keys(aRow)) {
      if (bRow[col] !== aRow[col]) changed[col] = { before: bRow[col], after: aRow[col] };
    }
    if (Object.keys(changed).length) playerDiff[pc] = changed;
  }
  const gameDiff = {};
  for (const col of Object.keys(after.game)) {
    if (before.game[col] !== after.game[col]) gameDiff[col] = { before: before.game[col], after: after.game[col] };
  }
  const usageBefore = new Map(before.usage.map(u => [`${u.player_code}:${u.ability}`, u.uses]));
  const usageDelta = {};
  for (const u of after.usage) {
    const key = `${u.player_code}:${u.ability}`;
    const d = u.uses - (usageBefore.get(key) || 0);
    if (d !== 0) usageDelta[key] = d;
  }

  // --- deaths -------------------------------------------------------------
  const deaths = [];
  for (const [pc, cols] of Object.entries(playerDiff)) {
    if (cols.alive && cols.alive.before === 1 && cols.alive.after === 0) {
      const cause = afterByCode.get(pc).death_cause;
      const CAUSE_STATION = {
        murder: 8, 'blood-ritual': 9, 'execute-on-sight': 6,
        animus: 'D4', torture: 'D2', lynch: 'D3',
      };
      deaths.push({
        playerCode: pc,
        cause,
        station: CAUSE_STATION[cause] ?? null,
        attributedTo: attributeKiller(cause, pc, submitted),
        confidence: CONFIDENCE.OBSERVED,
      });
    }
  }

  // --- drift ledger -------------------------------------------------------
  const drift = {};
  for (const entry of stream) {
    if (entry.src !== 'event' || entry.type !== 'drift') continue;
    const p = entry.payload;
    if (!drift[p.playerCode]) {
      const start = beforeByCode.get(p.playerCode)?.drift ?? p.before;
      drift[p.playerCode] = {
        before: start, after: start, net: 0,
        zoneBefore: zoneId(manager, start), zoneAfter: zoneId(manager, start),
        clamped: false, deltas: [], zoneCrossings: [],
      };
    }
    const led = drift[p.playerCode];
    // When a delta hits the 0/max_drift bound the arithmetic won't add up —
    // this SPECIFIC delta clamped, whether or not it ends up mattering to
    // the player's overall ledger (see the row-level `led.clamped` rollup
    // below the loop for why per-delta truth and the badge shown to a
    // reader are deliberately not the same thing).
    const clamped = (p.after - p.before) !== p.delta;
    led.deltas.push({
      seq: entry.seq, delta: p.delta, reason: p.reason, station: entry.station,
      before: p.before, after: p.after, confidence: entry.confidence, why: entry.why,
      clamped,
    });
    const from = zoneId(manager, p.before);
    const to = zoneId(manager, p.after);
    if (from !== to) led.zoneCrossings.push({ seq: entry.seq, from, to });
    led.after = p.after;
    led.zoneAfter = to;
    led.net = led.after - led.before;
  }

  // Row-level `clamped` badge: NOT "did any delta clamp" — the nightly
  // sleep recovery (NIGHTLY_SLEEP_RECOVERY) is negative, so every player
  // sitting at drift 0 clamps on an ordinary quiet night, every night. That
  // was the bug: badging that lights up the whole roster on every
  // resolution trains a reader to ignore the one badge meant to mean "the
  // arithmetic below won't add up."
  //
  // (First attempt: badge when naively summing the listed deltas doesn't
  // reproduce the actual net change. Rejected — on the *exact* quiet-night
  // case this is meant to fix, a player with a single sleep delta clamped
  // at the floor has rawSum=-1, net=0, so that mismatch alone still fires
  // every single night. A clamp on the only delta in the ledger will always
  // create that mismatch by construction, so it doesn't separate "routine"
  // from "worth a look" at all.)
  //
  // What a reader actually loses when a delta clamps is legibility about
  // where THIS resolution's net change came from — and that only matters
  // when there IS a net change to explain. A quiet night (net 0, nothing to
  // reconstruct) clamping at the floor is exactly the boring, fully-expected
  // case; a night where the player's drift actually moved AND at least one
  // of the deltas behind that move got truncated is the case where the
  // ledger below can mislead a reader doing the arithmetic by hand. So:
  // badge only when both hold. Per-delta truth (`deltas[].clamped`, set
  // above) is untouched either way — this only changes what gets badged at
  // the row level.
  for (const led of Object.values(drift)) {
    const anyDeltaClamped = led.deltas.some((d) => d.clamped);
    led.clamped = anyDeltaClamped && led.net !== 0;
  }

  // --- actions ------------------------------------------------------------
  const actions = [];
  const murderDeaths = deaths.filter(d => d.cause === 'murder').map(d => d.playerCode);
  const traps = new Set(submitted.filter(a => a.kind === 'boobytrap').map(a => a.target_code));
  const bodyguards = new Map(submitted.filter(a => a.kind === 'bodyguard').map(a => [a.target_code, a.actor_code]));
  const protectedIds = new Set(submitted.filter(a => a.kind === 'protect').map(a => a.target_code));

  for (const a of submitted) {
    actions.push(evaluateAction({
      action: a, stream, submitted, traps, bodyguards, protectedIds,
      murderDeaths, deaths, playerDiff, beforeByCode, afterByCode, drift, isNight,
    }));
  }

  // silent-crippled: submitAction (:1210) returns {silent:true} and writes NO
  // hr_actions row. At resolve time that is byte-identical to a genuine sleep,
  // so it is recoverable only from the BEFORE snapshot's cripple state plus
  // the role's night action.
  if (isNight) {
    const rules = manager.config.rules;
    for (const p of before.players) {
      if (!p.alive || actionByActor.has(p.player_code)) continue;
      const role = p.role_id ? manager.config.roles.get(p.role_id) : null;
      const kind = role?.actions?.night?.kind;
      if (!kind || kind === 'sleep' || !SILENT_KINDS.has(kind)) continue;
      if (effectiveCrippleTier(rules, p, round) <= 0) continue;
      actions.push({
        actorCode: p.player_code, actorName: p.name, kind, targetCode: null, variant: null,
        station: KIND_TO_STATION[kind] ?? null,
        verdict: VERDICTS.SILENT_CRIPPLED, confidence: CONFIDENCE.DERIVED_INPUT,
        trapScope: null, effectiveVictim: null,
        driftCharged: (drift[p.player_code]?.deltas || []).map(d => ({ delta: d.delta, reason: d.reason })),
        evidence: [], mismatch: null,
        why: `crippled actor with a ${kind} role and no hr_actions row — submitAction accepted it silently (:1210) and it resolves as a sleep`,
      });
    }
  }

  // --- stations -----------------------------------------------------------
  const stations = stationTable.map((s) => {
    const key = isNight ? s.n : s.n;
    const evidence = stream.filter(e => e.station === key).map(e => e.seq);
    const stationActions = actions.filter(a => a.station === key);
    const notes = stationActions.map(a => describeAction(a));
    const unobserved = unobservedFor(key, {
      submitted, traps, protectedIds, bodyguards, stream, actions, isNight,
    });
    return {
      n: key,
      name: s.name,
      ran: evidence.length > 0 || stationActions.length > 0,
      evidence,
      inputs: key === 0 ? {
        actions: submitted.map(a => `${a.actor_code}:${a.kind}${a.target_code ? '→' + a.target_code : ''}${a.variant ? '/' + a.variant : ''}`),
        traps: [...traps], protectedIds: [...protectedIds],
        bodyguards: Object.fromEntries(bodyguards),
      } : {},
      notes,
      unobserved,
    };
  });

  return {
    label, gameCode: code, phaseResolved, round,
    engineContractHash: safeHash(),
    stream, stations, actions, drift,
    diff: {
      game: gameDiff, players: playerDiff,
      newEventIds: newEvents.map(e => e.id),
      newMessageIds: newMessages.map(m => m.id),
      usageDelta,
    },
    deaths,
    integrity: null, // filled by verify()
    durationMs,
  };
}

function safeHash() {
  try { return computeEngineContractHash(REPO_ROOT); } catch { return null; }
}

function zoneId(manager, value) {
  try { return driftZone(manager.config.drift, value).id; } catch { return null; }
}

function attributeKiller(cause, victim, submitted) {
  if (cause === 'murder') {
    const kill = submitted.find(a => a.kind === 'kill' && (a.target_code === victim));
    if (kill) return kill.actor_code;
    // Bodyguard redirect: the victim is not the named target.
    const guarded = submitted.find(a => a.kind === 'bodyguard' && a.actor_code === victim);
    if (guarded) {
      const k = submitted.find(a => a.kind === 'kill' && a.target_code === guarded.target_code);
      if (k) return k.actor_code;
    }
  }
  if (cause === 'blood-ritual') return submitted.find(a => a.kind === 'blood-ritual')?.actor_code ?? null;
  return null;
}

/**
 * Decide what happened to one submitted action.
 *
 * The kill branch mirrors heresyGameManager.js:826-843 via KILL_PRECEDENCE.
 * Four of its five verdicts are observable; `absorbed-by-protect` is a pure
 * negative with no positive evidence at all, hence `derived-rule` and the
 * mandatory cross-check below.
 */
function evaluateAction(ctx) {
  const {
    action: a, stream, submitted, traps, bodyguards, protectedIds,
    murderDeaths, playerDiff, beforeByCode, drift,
  } = ctx;

  const base = {
    actorCode: a.actor_code,
    actorName: beforeByCode.get(a.actor_code)?.name ?? a.actor_code,
    kind: a.kind, targetCode: a.target_code, variant: a.variant,
    station: KIND_TO_STATION[a.kind] ?? null,
    trapScope: traps.has(a.actor_code) ? (traps.has(a.target_code) ? 'both' : 'actor')
      : traps.has(a.target_code) ? 'target' : null,
    effectiveVictim: null,
    driftCharged: (drift[a.actor_code]?.deltas || []).map(d => ({ delta: d.delta, reason: d.reason })),
    evidence: stream.filter(e => involvesActor(e, a.actor_code)).map(e => e.seq),
    mismatch: null,
  };

  const trapDriftOnActor = (drift[a.actor_code]?.deltas || []).some(d => d.reason === 'trap');

  // The actor may have been killed EARLIER in the same night, at a station
  // before their own action's. Every attack station opens with a liveness
  // guard — `if(!killer?.alive) continue` (:826) — so the action silently
  // evaporates: no drift, no event, no message, nothing. Without this branch
  // it falls through to `unknown` and the trace reports "the precedence chain
  // does not explain this", which is both unhelpful and untrue. It is fully
  // observable: the actor is in deaths[] with an earlier station number.
  const actorDeath = (ctx.deaths || []).find(d => d.playerCode === a.actor_code);
  if (actorDeath && typeof actorDeath.station === 'number'
      && typeof (KIND_TO_STATION[a.kind]) === 'number'
      && actorDeath.station < KIND_TO_STATION[a.kind]) {
    return {
      ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.OBSERVED,
      why: `the actor was killed at station ${actorDeath.station} (${actorDeath.cause}), before station ${KIND_TO_STATION[a.kind]} resolved — the engine skips actions by the dead`,
    };
  }

  if (a.kind === 'kill') {
    const gated = stream.some(e => e.src === 'event' && e.type === 'night-action'
      && String(e.payload?.kind).startsWith('murderer') && e.payload?.actor === a.actor_code);
    let verdict, confidence, why, predictedVictim;

    if (gated) {
      verdict = VERDICTS.GATED_BY_DRIFT; confidence = CONFIDENCE.OBSERVED; predictedVictim = null;
      why = 'murderer:kill-gated event, murderer-gate-witnessed drift and a private gate cue all agree';
    } else if (traps.has(a.actor_code) && trapDriftOnActor) {
      // A trap on the TARGET does not block (:829 charges drift and falls
      // through); only an actor-trap causes the `continue`.
      verdict = VERDICTS.BLOCKED_BY_TRAP; confidence = CONFIDENCE.DERIVED_INPUT; predictedVictim = null;
      why = 'a boobytrap targets the actor and trap drift was charged to them; only actor-traps stop a kill (:829)';
    } else if (bodyguards.has(a.target_code) && murderDeaths.includes(bodyguards.get(a.target_code))) {
      verdict = VERDICTS.REDIRECTED_TO_BODYGUARD; confidence = CONFIDENCE.OBSERVED;
      predictedVictim = bodyguards.get(a.target_code);
      base.effectiveVictim = predictedVictim;
      why = `${predictedVictim} died with death_cause=murder and is the bodyguard of the named target ${a.target_code}`;
    } else if (murderDeaths.includes(a.target_code)) {
      verdict = VERDICTS.LANDED; confidence = CONFIDENCE.OBSERVED; predictedVictim = a.target_code;
      base.effectiveVictim = a.target_code;
      why = 'the named target died with death_cause=murder';
    } else if (protectedIds.has(a.target_code)) {
      // No positive evidence exists for this branch — the engine simply sets
      // victim = null and says nothing. Derived, and cross-checked below.
      verdict = VERDICTS.ABSORBED_BY_PROTECT; confidence = CONFIDENCE.DERIVED_RULE; predictedVictim = null;
      why = 'nobody died, the actor was not trapped, and a protect covered the target — inferred from KILL_PRECEDENCE, not observed';
    } else {
      verdict = VERDICTS.UNKNOWN; confidence = CONFIDENCE.DERIVED_RULE; predictedVictim = null;
      why = 'no death and no matching defence — the precedence chain does not explain this';
    }

    // MANDATORY CROSS-CHECK. The derived verdict predicts a concrete victim;
    // compare it against what the row diff actually shows. On disagreement we
    // degrade to `unknown` and flip integrity rather than assert a story the
    // database contradicts.
    const actuallyDied = murderDeaths.filter(v => v === predictedVictim || (predictedVictim === null && (v === a.target_code || v === bodyguards.get(a.target_code))));
    if (predictedVictim && !murderDeaths.includes(predictedVictim)) {
      base.mismatch = { predicted: predictedVictim, observed: murderDeaths, detail: 'predicted victim did not die' };
      verdict = VERDICTS.UNKNOWN;
    } else if (!predictedVictim && actuallyDied.length) {
      base.mismatch = { predicted: null, observed: actuallyDied, detail: 'predicted nobody would die, but someone did' };
      verdict = VERDICTS.UNKNOWN;
    }

    return { ...base, verdict, confidence, why };
  }

  if (a.kind === 'blood-ritual') {
    // Station 9 is the ONLY attack station that self-reports.
    const ev = stream.find(e => e.src === 'event' && e.type === 'blood-ritual');
    if (ev) {
      return {
        ...base,
        verdict: ev.payload.landed ? VERDICTS.LANDED : VERDICTS.NO_OP,
        confidence: CONFIDENCE.OBSERVED,
        effectiveVictim: ev.payload.landed ? ev.payload.target : null,
        why: `blood-ritual event reports outcome=${ev.payload.outcome}, landed=${ev.payload.landed}`,
      };
    }
    // BUG FIX: this used to check traps.has(a.actor_code) and report
    // blocked-by-trap. But :854 only ever TAXES a Blood Ritual attacker for a
    // trap on the TARGET (`if(traps.has(sv.target_code))changeDrift(...,
    // 'trap')`) — there is no `continue` anywhere in that station, so a trap
    // never blocks a Blood Ritual at all, on either end. The only way this
    // event goes missing is the attacker being dead by the time night
    // resolution reaches this station (:854's own `if(!attacker?.alive)
    // continue` guard) — a boobytrap has nothing to do with it.
    return { ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.DERIVED_ABSENCE, why: 'no blood-ritual event was emitted — a trap only taxes a Blood Ritual (:854), it never blocks one, so the attacker was most likely dead by the time night resolution reached this station' };
  }

  // BUG FIX: trap-gating past this point used to be one blanket check —
  // `traps.has(a.actor_code) && trapDriftOnActor` — treating every kind the
  // same way kill's bespoke actor-trap-blocks rule works. That's wrong for
  // most of them. The engine actually has two DIFFERENT trap shapes here:
  //   - possess mirrors kill exactly: its own bespoke check at :879 blocks
  //     on a trap covering the ACTOR (`if(traps.has(pos.actor_code))
  //     ...continue`); a trap on the target only taxes.
  //   - protect/bodyguard/infect/sermon/corrupt-sermon/investigate/
  //     drift-hint/warp-read all go through the shared trapBlocks() helper
  //     (:1004), which blocks on a trap covering the ACTION'S TARGET instead
  //     — "Your trap caught X targeting Y" catches whoever aims AT the
  //     trapped player, not the trapped player's own moves.
  //   - heretical-catalyst is trap-checked too (:820) but has no `continue`
  //     at all — a trap only ever taxes it, never blocks — so it's excluded
  //     from both branches below. boobytrap actions themselves aren't run
  //     through any trap gate (they're indexed at station 0, not dispatched);
  //     excluded defensively for the same reason.
  const actorTrapBlocks = a.kind === 'possess';
  const targetTrapBlocks = !['heretical-catalyst', 'boobytrap'].includes(a.kind);
  if (actorTrapBlocks && traps.has(a.actor_code) && trapDriftOnActor) {
    return { ...base, verdict: VERDICTS.BLOCKED_BY_TRAP, confidence: CONFIDENCE.DERIVED_INPUT, why: 'a boobytrap targets the actor and trap drift was charged; possess blocks on an actor-trap the same way a kill does (:879)' };
  }
  if (targetTrapBlocks && traps.has(a.target_code) && trapDriftOnActor) {
    return { ...base, verdict: VERDICTS.BLOCKED_BY_TRAP, confidence: CONFIDENCE.DERIVED_INPUT, why: "a boobytrap targets this action's target and trap drift was charged to the actor — trapBlocks() (:1004) catches whoever targets a trapped player, not the trapped player's own actions" };
  }

  if (a.kind === 'sermon' || a.kind === 'corrupt-sermon') {
    const paid = (drift[a.actor_code]?.deltas || []).some(d => d.reason === 'sermon-self');
    if (paid) return { ...base, verdict: VERDICTS.LANDED, confidence: CONFIDENCE.OBSERVED, why: 'sermon-self drift was charged' };
    // The Warp Litany gate (:817) emits LITERALLY NOTHING — no drift, no
    // usage, no message to either side — deliberately, so a Heretic Priest
    // cannot probe hidden drift by reading the acknowledgement. Detectable
    // only by absence, which is sound because changeDrift always emits.
    return {
      ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.DERIVED_ABSENCE,
      why: 'no sermon-self drift row exists, so the tier gate rejected it — the engine is silent here by design (:817)',
    };
  }

  if (a.kind === 'possess') {
    const msg = stream.find(e => e.src === 'message' && e.meta?.intelKind === INTEL_KIND.ANIMUS_POSSESS);
    if (msg) {
      const ok = msg.meta.outcome === 'success';
      return {
        ...base, verdict: ok ? VERDICTS.LANDED : VERDICTS.NO_OP, confidence: CONFIDENCE.OBSERVED,
        effectiveVictim: ok ? a.target_code : null,
        // The engine deliberately conflates "target wasn't Red" with "target
        // was protected" so the Animus never learns which. Report the outcome
        // as observed and leave the CAUSE alone rather than inventing one.
        why: ok ? 'animus_possess reported success' : 'animus_possess reported failure; the engine does not disclose whether the target was out of zone or protected',
      };
    }
    return { ...base, verdict: VERDICTS.UNKNOWN, confidence: CONFIDENCE.DERIVED_ABSENCE, why: 'no animus_possess message was emitted' };
  }

  if (a.kind === 'heretical-catalyst') {
    const flipped = playerDiff[a.target_code]?.faction;
    return flipped
      ? { ...base, verdict: VERDICTS.LANDED, confidence: CONFIDENCE.OBSERVED, effectiveVictim: a.target_code, why: `target faction ${flipped.before} → ${flipped.after}` }
      : { ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.DERIVED_INPUT, why: 'target faction unchanged — the catalyst requires max drift' };
  }

  if (a.kind === 'infect') {
    const ev = stream.find(e => e.src === 'event' && e.type === 'night-action' && String(e.payload?.kind).startsWith('poxwalker'));
    return ev
      ? { ...base, verdict: VERDICTS.LANDED, confidence: CONFIDENCE.OBSERVED, effectiveVictim: a.target_code, why: 'poxwalker:infect event names patient zero' }
      : { ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.DERIVED_ABSENCE, why: 'no poxwalker:infect event was emitted' };
  }

  if (['investigate', 'warp-read', 'drift-hint'].includes(a.kind)) {
    const intel = stream.find(e => e.src === 'message' && e.recipientCode === a.actor_code && e.meta?.intelKind);
    return intel
      ? { ...base, verdict: VERDICTS.LANDED, confidence: CONFIDENCE.OBSERVED, why: `intel delivered (${intel.meta.intelKind})` }
      : { ...base, verdict: VERDICTS.NO_OP, confidence: CONFIDENCE.DERIVED_ABSENCE, why: 'no intel message reached the actor' };
  }

  if (a.kind === 'protect' || a.kind === 'bodyguard') {
    // A landed protect/bodyguard on an unattacked target leaves ZERO
    // evidence. Whether it absorbed anything is decided at station 8/9, so
    // that verdict belongs there, not here.
    return {
      ...base, verdict: VERDICTS.LANDED, confidence: CONFIDENCE.DERIVED_INPUT,
      why: 'the actor was not trapped, so the defence was registered; whether it absorbed anything is decided at the kill station',
    };
  }

  if (a.kind === 'boobytrap') {
    const caught = submitted.find(x => x.actor_code === a.target_code);
    return {
      ...base, verdict: caught ? VERDICTS.LANDED : VERDICTS.NO_OP,
      confidence: CONFIDENCE.DERIVED_INPUT,
      effectiveVictim: caught ? a.target_code : null,
      why: caught ? `the trapped player submitted a ${caught.kind}` : 'the trapped player took no action',
    };
  }

  return { ...base, verdict: VERDICTS.UNKNOWN, confidence: CONFIDENCE.UNOBSERVABLE, why: `no evaluator for kind "${a.kind}"` };
}

function involvesActor(entry, actorCode) {
  if (entry.src === 'event' && entry.payload) {
    const p = entry.payload;
    if (p.playerCode === actorCode || p.actor === actorCode || p.attacker === actorCode) return true;
  }
  if (entry.src === 'message' && entry.recipientCode === actorCode) return true;
  return false;
}

function describeAction(a) {
  const target = a.targetCode ? ` → ${a.targetCode}` : '';
  const variant = a.variant ? `/${a.variant}` : '';
  const victim = a.effectiveVictim && a.effectiveVictim !== a.targetCode ? ` (hit ${a.effectiveVictim})` : '';
  return `${a.actorCode} ${a.kind}${variant}${target}: ${a.verdict}${victim} — ${a.why}`;
}

/** Things a station did that leave no trace at all, stated plainly. */
function unobservedFor(station, ctx) {
  const out = [];
  if (station === 0) {
    out.push('Station 0 leaves no evidence by construction — the action, trap, protect and bodyguard sets shown here are reconstructed from hr_actions, not observed during resolution.');
  }
  if (station === 2 || station === 3) {
    const kind = station === 2 ? 'protect' : 'bodyguard';
    const defences = ctx.submitted.filter(a => a.kind === kind);
    const attacked = new Set(ctx.submitted.filter(a => a.kind === 'kill' || a.kind === 'blood-ritual').map(a => a.target_code));
    for (const d of defences) {
      if (!attacked.has(d.target_code)) {
        out.push(`${d.actor_code}'s ${kind} on ${d.target_code} landed, but nothing attacked them — a defence that absorbs nothing emits no evidence whatsoever.`);
      }
    }
    if (station === 2) {
      out.push('A landed protect also silently cures the plague (clearPlague). The engine emits nothing for the cure — the Chirurgeon must not be able to read plague state off their own action.');
    }
  }
  if (station === 5) {
    for (const a of ctx.actions) {
      if ((a.kind === 'sermon' || a.kind === 'corrupt-sermon') && a.verdict === VERDICTS.NO_OP) {
        out.push(`${a.actorCode}'s ${a.variant || 'sermon'} fizzled below the drift gate. The engine emits nothing for this branch by design (:817), so this is inferred from the absence of a sermon-self drift row.`);
      }
    }
  }
  if (station === 10) {
    for (const a of ctx.actions) {
      if (a.kind === 'possess' && a.verdict === VERDICTS.NO_OP) {
        out.push('The possession failed, but the engine deliberately does not disclose whether the target was out of the Red zone or was protected — the Animus never learns which.');
      }
    }
  }
  if (station === 12) {
    out.push('Proximity Siphon reports a total only. The per-neighbour split lives in a resolve-local map the engine never persists.');
  }
  return out;
}

// ── verification ───────────────────────────────────────────────────────────

/**
 * Self-check. A trace that cannot substantiate itself says so rather than
 * quietly presenting a plausible story.
 */
export function verify(trace, extra = {}) {
  const violations = [];

  // Station numbers must not go backwards. A violation means either a
  // classifier bug or an engine reorder — both worth shouting about.
  let monotonic = true;
  let lastNumeric = -1;
  for (const e of trace.stream) {
    if (typeof e.station !== 'number') continue;
    if (e.station < lastNumeric) {
      monotonic = false;
      violations.push({ kind: 'non-monotonic-station', seq: e.seq, detail: `station ${e.station} follows ${lastNumeric}` });
    }
    lastNumeric = Math.max(lastNumeric, e.station);
  }

  const capturedEvents = trace.stream.filter(e => e.src === 'event').length;
  const actualEvents = (extra.newEvents || []).length || trace.diff.newEventIds.length;
  const streamComplete = capturedEvents === actualEvents;
  if (!streamComplete) {
    violations.push({ kind: 'stream-incomplete', seq: null, detail: `captured ${capturedEvents} events but ${actualEvents} rows were written` });
  }

  const mismatches = trace.actions.filter(a => a.mismatch);
  const verdictsAgreeWithRows = mismatches.length === 0;
  for (const m of mismatches) {
    violations.push({ kind: 'verdict-mismatch', seq: null, detail: `${m.actorCode} ${m.kind}: ${m.mismatch.detail}` });
  }

  const contractHashMatches = trace.engineContractHash === ENGINE_CONTRACT.hash;
  if (!contractHashMatches) {
    violations.push({ kind: 'engine-contract-changed', seq: null, detail: 'the engine changed since this trace logic was validated — every derived claim is suspect' });
  }

  return {
    ok: monotonic && streamComplete && verdictsAgreeWithRows && contractHashMatches,
    monotonic, streamComplete, verdictsAgreeWithRows, contractHashMatches, violations,
  };
}
