/**
 * Sandbox — an isolated, deterministic HeresyGameManager instance for the
 * playground. The playground is a *consumer* of the engine, exactly like
 * heresy-sim/, not a fork of it: every mutation below goes through the real
 * `heresy-server/src/heresyGameManager.js`, never a re-implementation.
 *
 * Four load-bearing decisions, in one place so nobody "simplifies" them
 * back into bugs later:
 *
 * 1. In-memory DB (`databasePath: ':memory:'`). journal_mode=WAL is a no-op
 *    on an in-memory database, so the whole WAL-checkpoint / stale-`-wal`
 *    corruption class the live server can hit simply does not exist here.
 *    The engine constructor also does `fs.mkdirSync(path.dirname(dbPath))`,
 *    which for ':memory:' resolves to `mkdirSync('.', {recursive:true})` —
 *    a harmless no-op, no file ever created. And most importantly: an
 *    in-memory DB makes it *structurally impossible* for this tool to ever
 *    touch the live deployment database (see AGENTS.md).
 *
 * 2. Frozen clock (`now: () => FROZEN_NOW`). Kills all deadline logic. The
 *    playground doesn't wait on wall-clock phase timers — it always
 *    force-resolves (see `resolve()` below) — so a clock that never moves
 *    is exactly what we want, not a bug to work around.
 *
 * 3. No `Math.random` monkey-patch. heresy-sim/src/runner.js patches the
 *    *global* Math.random because it's a one-shot batch process — safe
 *    there, not here. This is a long-lived server: a global patch would
 *    let concurrent sandbox sessions interleave draws from each other's
 *    seeded streams, and a throw without a `finally` restore would poison
 *    Math.random for the entire process, forever. Instead each sandbox
 *    gets its own seeded, instrumented RNG object injected as the
 *    constructor's `random` function (see `createSeededRng` below).
 *
 * 4. Full manual role assignment, always. `start()`'s only two bare
 *    Math.random() call sites reachable from create()/start() are
 *    utils.js's `generateRoomCode` (cosmetic — the 6-char room code) and
 *    `shuffle()` (role assignment for any seat NOT covered by
 *    manualAssignments). By always supplying a manualAssignments entry for
 *    every seat, resolveManualAssignment's leftover pool is empty and
 *    shuffle() never draws. Every *resolve-time* roll (night/day
 *    resolution) already goes through the injected `random`, so with full
 *    manual assignment the room code is the only nondeterminism left, and
 *    it's cosmetic.
 *
 * Admin gate (heresyGameManager.js:728): `start()` only routes to
 * resolveManualAssignment when `this.isAdmin(callerCode)` is true — anyone
 * else's manualAssignments are silently ignored and every seat is
 * shuffle()'d instead. "Silently" is the dangerous part: a caller who
 * forgets this would get a perfectly successful `start()` call with
 * completely wrong (and non-deterministic) roles. `createSandbox` below
 * always admin-lists its own host code before calling start(), and then
 * re-verifies every seat actually landed the requested role, so this
 * failure mode turns into a loud thrown Error instead of a silent bug.
 *
 * Prepared-statement caching claim: `manager.db.constructor` is used for
 * snapshot/rewind below instead of importing better-sqlite3 directly (a
 * second copy would mean a second native build in playground/node_modules
 * and a real risk of version skew against heresy-server's copy). Swapping
 * `manager.db` out for a deserialized clone after `rewind()` is only safe
 * because the engine caches ZERO prepared statements anywhere — every
 * query in heresyGameManager.js is an inline `this.db.prepare(...)` call,
 * so there is no stale Statement object anywhere holding a reference to the
 * old connection. Verified with:
 *   grep -n "this\.\(stmt\|_stmt\|prepared\|cache\)" heresyGameManager.js
 * which returns nothing. If a future engine change adds any cached
 * Statement, this snapshot/rewind scheme breaks silently (stale-handle
 * errors) — re-run that grep before trusting it again.
 *
 * Game-log litter: finishIfWon() and adminEndGame() call
 * saveGameLogSnapshot(), which writes a JSON file to a path anchored to
 * gameLogs.js's own directory with no env override — we're told not to
 * patch it. Handled post-hoc with the engine's already-exported
 * deleteGameLog(id): `run()` below checks after every mutation whether the
 * game just ended and deletes its log immediately, and `close()` does the
 * same defensively. `sweepOrphanLogs()` is a best-effort *in-process*
 * safety net on top of that — see its own comment for why it can't be more
 * than that without persisting a registry to disk, which this module
 * deliberately avoids.
 */

import crypto from 'node:crypto';
import { HeresyGameManager } from '../../heresy-server/src/heresyGameManager.js';
import { validateComposition } from '../../heresy-server/src/validators/composition.js';
import { deleteGameLog } from '../../heresy-server/src/gameLogs.js';

// Frozen virtual clock — see file header point 2. The exact value doesn't
// matter (no wall-clock arithmetic anywhere reads it as a real timestamp);
// it just has to never change within a sandbox's lifetime.
const FROZEN_NOW = 1_000_000;

// ── Seeded, instrumented RNG (file header point 3) ─────────────────────────

// mulberry32: small, fast, deterministic 32-bit PRNG. Good enough for game
// mechanics (role shuffles, drift-hint noise, etc.) — not cryptographic,
// and it doesn't need to be. Implemented locally rather than imported from
// heresy-sim/src/util.js's seedableRNG: the dispatch is explicit that a
// playground package must not reach across the heresy-sim package boundary
// for this.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {Object} SeededRng
 * @property {() => number} next - Returns the next float in [0,1) and records it in `draws`.
 * @property {number[]} draws - Every value `next()` has returned, in order. Consumed by
 *   trace.js to turn RNG-dependent resolution outcomes into observed facts.
 * @property {(seed:number) => void} reseed - Re-seeds the generator and clears `draws`.
 * @property {number} drawCount - `draws.length`, exposed as a convenience getter.
 * @property {number} seed - The current seed.
 */

/** @returns {SeededRng} */
function createSeededRng(seed) {
  let gen = mulberry32(seed);
  const draws = [];
  const rng = {
    seed,
    draws,
    next() {
      const value = gen();
      draws.push(value);
      return value;
    },
    reseed(newSeed) {
      rng.seed = newSeed;
      gen = mulberry32(newSeed);
      draws.length = 0;
    },
  };
  Object.defineProperty(rng, 'drawCount', { get: () => draws.length });
  return rng;
}

// ── Seat/role assignment (file header point 4) ─────────────────────────────

/**
 * Resolve which role each seat gets. Defaults to positional (roster[i] for
 * players[i]); `manualAssignments`, if given, overrides the seat<->role
 * mapping — as an array parallel to `players`, or an object keyed by seat
 * index — but must still land on the exact same multiset `roster` declares.
 *
 * `resolveManualAssignment` (heresy-server/src/validators/manualAssignment.js)
 * happily accepts a *partial* map and shuffle()'s the rest, which is exactly
 * the nondeterminism this module exists to avoid — so full coverage and an
 * exact multiset match are enforced here, up front, rather than left to be
 * silently patched over at start() time.
 *
 * @param {string[]|Record<number,string>|null|undefined} manualAssignments
 * @param {string[]} roster
 * @param {number} count
 * @returns {string[]} seatRoleIds, parallel to the players array.
 */
function resolveSeatRoles(manualAssignments, roster, count) {
  let seatRoleIds;
  if (manualAssignments == null) {
    seatRoleIds = roster.slice();
  } else if (Array.isArray(manualAssignments)) {
    seatRoleIds = manualAssignments.slice();
  } else if (typeof manualAssignments === 'object') {
    seatRoleIds = Array.from({ length: count }, (_, i) => manualAssignments[i] ?? manualAssignments[String(i)]);
  } else {
    throw new Error('manualAssignments must be an array or an object keyed by seat index');
  }
  if (seatRoleIds.length !== count || seatRoleIds.some(r => typeof r !== 'string' || !r)) {
    throw new Error(`manualAssignments must supply exactly one roleId per seat (${count} seats)`);
  }
  const remaining = roster.slice();
  for (const id of seatRoleIds) {
    const idx = remaining.indexOf(id);
    if (idx === -1) {
      throw new Error(`manualAssignments role "${id}" is not present (or already fully used) in roster`);
    }
    remaining.splice(idx, 1);
  }
  return seatRoleIds;
}

// ── Whitelisted raw-SQL escape hatches (never interpolate a caller string) ─

// Player columns adminUpdatePlayer() (heresyGameManager.js:1382) doesn't
// cover. Keys are the caller-facing field name; values describe the exact
// hr_players column and how to coerce the input. This Map IS the whitelist
// — setPlayerRaw() below only ever touches a column listed here.
const RAW_PLAYER_FIELDS = {
  torturedBefore: { column: 'tortured_before', type: 'bool' },
  markPublic: { column: 'mark_public', type: 'bool' },
  possessedBy: { column: 'possessed_by', type: 'text' },
  possessionRevealed: { column: 'possession_revealed', type: 'bool' },
  plagueCarrier: { column: 'plague_carrier', type: 'bool' },
  tier1UntilRound: { column: 'tier1_until_round', type: 'intOrNull' },
  deathCause: { column: 'death_cause', type: 'text' },
  seat: { column: 'seat', type: 'int' },
  displayOrder: { column: 'display_order', type: 'int' },
};

// Game-row columns start()/configure()/adminUpdatePlayer() don't cover.
// phase/round/dayStage ARE listed here (setGameFields is the generic
// escape hatch), but forcePhase() below is the documented, preferred path
// for that specific triple — see its own comment for why.
const RAW_GAME_FIELDS = {
  phase: { column: 'phase', type: 'text' },
  round: { column: 'round', type: 'int' },
  dayStage: { column: 'day_stage', type: 'text' },
  patientZero: { column: 'patient_zero', type: 'text' },
  maxDrift: { column: 'max_drift', type: 'int' },
  deathReveal: { column: 'death_reveal', type: 'text' },
  // Off by default (file header / dispatch requirement) because it also
  // triggers a codename shuffle — but ONLY inside start()'s own
  // transaction. Flipping this flag afterward via setGameFields turns on
  // display of a codename that was never assigned, so displayName() just
  // keeps showing the real name. Set BEFORE start() (not supported by this
  // module — construct a fresh sandbox instead) if you actually need
  // codenames.
  anonymized: { column: 'anonymized', type: 'bool' },
  warpTaintVisible: { column: 'warp_taint_visible', type: 'bool' },
  lastTorturedTarget: { column: 'last_tortured_target', type: 'text' },
  lastTortureTier: { column: 'last_torture_tier', type: 'int' },
};

function coerceRawValue(type, value) {
  switch (type) {
    case 'bool':
      return value ? 1 : 0;
    case 'int':
      return Number(value) || 0;
    case 'intOrNull':
      return value === null || value === undefined ? null : (Number(value) || 0);
    case 'text':
      return value === null || value === undefined ? null : String(value);
    default:
      return value;
  }
}

function applyRawFields(db, table, whereSql, whereArgs, whitelist, updates, now) {
  const fields = [];
  const values = [];
  for (const [key, spec] of Object.entries(whitelist)) {
    if (updates[key] === undefined) continue;
    fields.push(`${spec.column}=?`);
    values.push(coerceRawValue(spec.type, updates[key]));
  }
  if (!fields.length) return false;
  if (now !== undefined) {
    fields.push('updated_at=?');
    values.push(now);
  }
  db.prepare(`UPDATE ${table} SET ${fields.join(',')} WHERE ${whereSql}`).run(...values, ...whereArgs);
  return true;
}

// ── Sandbox construction ────────────────────────────────────────────────

/**
 * @typedef {Object} SandboxPlayerSpec
 * @property {string} name
 */

/**
 * @typedef {Object} CreateSandboxOptions
 * @property {SandboxPlayerSpec[]} players - 5-12 entries; players[0] becomes the host/admin.
 * @property {string[]} roster - Role-id multiset, same length as `players`.
 * @property {string[]|Record<number,string>} [manualAssignments] - Seat->role override; see
 *   `resolveSeatRoles`. Defaults to the positional roster[i]<->players[i] mapping.
 * @property {number} [seed] - RNG seed. Defaults to Date.now() when omitted (non-reproducible).
 * @property {{mode?:'live'|'async', dayMs?:number, nightMs?:number, maxDrift?:number,
 *   hintProfile?:string, dayStartMinuteUtc?:number}} [options]
 */

/**
 * @typedef {Object} Sandbox
 * @property {string} sessionId
 * @property {string} code - The engine's own room code.
 * @property {string} hostCode - playerCode of players[0]; also the admin-listed caller for start().
 * @property {HeresyGameManager} manager
 * @property {SeededRng} rng
 * @property {number} seed
 * @property {number} createdAt
 * @property {(fn:(sandbox:Sandbox)=>any) => Promise<any>} run - Per-sandbox mutex; see file header.
 * @property {(force?:boolean) => any} resolve
 * @property {(phase:string, round:number, dayStage?:string|null) => any} forcePhase
 * @property {(phase:string, round:number, dayStage?:string|null) => any} applyPhase
 * @property {(playerCode:string, updates:object) => any} updatePlayer
 * @property {(playerCode:string, updates:object) => any} setPlayerRaw
 * @property {(updates:object) => any} setGameFields
 * @property {(playerCode:string, ability:string, uses:number) => number} setUsage
 * @property {() => {playerCode:string,name:string,seat:number,isHost:boolean}[]} listPlayerCodes
 * @property {(label?:string) => {label:string|null,at:number,index:number}} snapshot
 * @property {() => {label:string|null,at:number,index:number}} rewind
 * @property {() => {label:string|null,at:number,index:number}[]} history
 * @property {() => void} close
 */

/** In-memory registry of live sandboxes, keyed by sessionId. */
const sandboxes = new Map();

// Every room code this process has ever minted via createSandbox — see
// sweepOrphanLogs() below for why this can only ever be an in-process,
// best-effort registry rather than a durable one.
const createdCodes = new Set();

/**
 * Create a fresh, deterministic sandbox: creates the game with the host,
 * joins the rest of the roster, readies everyone, then starts with a fully
 * manual composition (see file header points 3-4). Lands in Day 1, round 1
 * on return — call `forcePhase`/`applyPhase` to jump anywhere else.
 *
 * @param {CreateSandboxOptions} opts
 * @returns {Sandbox}
 */
export function createSandbox(opts = {}) {
  const players = Array.isArray(opts.players) ? opts.players : [];
  const roster = Array.isArray(opts.roster) ? opts.roster.slice() : [];
  if (!players.length) throw new Error('createSandbox requires at least one player');
  if (roster.length !== players.length) {
    throw new Error(`roster length (${roster.length}) must equal player count (${players.length})`);
  }

  const sessionId = crypto.randomUUID();
  const seed = Number.isFinite(opts.seed) ? (opts.seed >>> 0) : (Date.now() >>> 0);
  const rng = createSeededRng(seed);

  // Mutable Set passed BY REFERENCE into the constructor — we add the host
  // code to it below, before start() is ever called. See file header:
  // "Admin gate".
  const adminPlayerCodes = new Set();

  const manager = new HeresyGameManager({
    databasePath: ':memory:', // file header point 1
    now: () => FROZEN_NOW, // file header point 2
    random: () => rng.next(), // file header point 3 — a function, per the constructor's contract
    adminPlayerCodes,
  });

  const { MIN_PLAYERS, MAX_PLAYERS } = manager.config.rules;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    manager.close();
    throw new Error(`Sandbox requires ${MIN_PLAYERS}-${MAX_PLAYERS} players (got ${players.length})`);
  }

  // Pre-validate with the engine's own validator and auto-confirm every
  // soft warning (S1-S7) up front — deliberately unbalanced boards are the
  // entire point of this tool, so nothing here should ever block on a
  // soft rule. Using validateComposition directly (rather than a
  // fail-then-retry round-trip through start()) means start() below only
  // ever needs to be called once.
  const precheck = validateComposition({
    roster,
    playerCount: players.length,
    confirmedWarnings: [],
    validRoles: manager.config.roles,
    hardRules: manager.config.hardRules,
    source: 'custom',
  });
  const hardErrors = precheck.errors.filter(e => e.kind === 'hard');
  if (hardErrors.length) {
    manager.close();
    throw new Error(`Invalid roster: ${hardErrors.map(e => e.message).join('; ')}`);
  }
  const confirmedWarnings = precheck.warnings.map(w => w.rule);

  // playerCode generation: sessionId is already a UUID, so `${sessionId}-pN`
  // is guaranteed unique within this process without any extra bookkeeping.
  const playerCodes = players.map((_, i) => `${sessionId}-p${i}`);
  const hostCode = playerCodes[0];
  adminPlayerCodes.add(hostCode); // see file header: "Admin gate" — MUST happen before start()

  const mode = opts.options?.mode === 'async' ? 'async' : 'live';
  const { code } = manager.create({
    playerCode: hostCode,
    name: players[0]?.name || 'Host',
    mode,
    options: {
      dayMs: opts.options?.dayMs,
      nightMs: opts.options?.nightMs,
      maxDrift: opts.options?.maxDrift,
      hintProfile: opts.options?.hintProfile,
      dayStartMinuteUtc: opts.options?.dayStartMinuteUtc,
    },
  });
  createdCodes.add(code);

  manager.ready(code, hostCode, true);
  for (let i = 1; i < players.length; i += 1) {
    manager.join({ code, playerCode: playerCodes[i], name: players[i]?.name || `Player ${i + 1}` });
    manager.ready(code, playerCodes[i], true);
  }

  const seatRoleIds = resolveSeatRoles(opts.manualAssignments, roster, players.length);
  /** @type {Record<string,string>} */
  const manualAssignments = {};
  playerCodes.forEach((pc, i) => { manualAssignments[pc] = seatRoleIds[i]; });

  const startResult = manager.start(code, hostCode, {
    maxDrift: opts.options?.maxDrift,
    dayMs: opts.options?.dayMs,
    nightMs: opts.options?.nightMs,
    composition: { source: 'custom', roster, manualAssignments, confirmedWarnings },
  });
  // start() returns {ok:false,...} rather than throwing on composition
  // validation failure — must be checked explicitly (file header / dispatch
  // requirement #4).
  if (startResult && startResult.ok === false) {
    const detail = (startResult.errors || []).map(e => e.message).join('; ') || 'composition validation failed';
    manager.close();
    throw new Error(`Sandbox start rejected: ${detail}`);
  }

  // Determinism guard (file header: "Admin gate"). A silent fallback to
  // shuffle() here would quietly destroy reproducibility with no error
  // anywhere — assert every seat landed exactly the role requested instead.
  for (const pc of playerCodes) {
    const row = manager.player(code, pc);
    const expected = manualAssignments[pc];
    if (!row || row.role_id !== expected) {
      manager.close();
      throw new Error(
        `Manual assignment failed for ${pc}: expected role "${expected}", got "${row?.role_id ?? 'undefined'}". ` +
        'This should be impossible once hostCode is admin-listed before start() — check the admin gate.'
      );
    }
  }

  const sandbox = buildSandbox({ sessionId, code, hostCode, manager, rng, seed });
  sandboxes.set(sessionId, sandbox);
  return sandbox;
}

/** @returns {Sandbox|undefined} */
export function getSandbox(sessionId) {
  return sandboxes.get(sessionId);
}

/** @returns {{sessionId:string, createdAt:number, playerCount:number, phase:string|null, round:number|null}[]} */
export function listSandboxes() {
  return [...sandboxes.values()].map(s => {
    const g = s.manager.game(s.code);
    return {
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      playerCount: s.manager.players(s.code).length,
      phase: g?.phase ?? null,
      round: g?.round ?? null,
    };
  });
}

export function destroySandbox(sessionId) {
  // Thin wrapper: sandbox.close() (below) already deregisters itself, so
  // this works identically whether a caller destroys a sandbox through this
  // function or by calling .close() directly on a Sandbox object it's
  // holding onto — either path leaves no dangling entry in `sandboxes` for
  // listSandboxes()/getSandbox() to trip over.
  sandboxes.get(sessionId)?.close();
}

/**
 * Startup cleanup for stray game-log JSON files (see file header:
 * "Game-log litter").
 *
 * This can only ever be a best-effort, IN-PROCESS safety net, not a true
 * cross-restart orphan sweep — and that limitation is deliberate, not an
 * oversight. Game codes are minted by the engine's own
 * generateRoomCode()/utils.js — six random letters from a fixed alphabet,
 * with no hook for this module to stamp a playground-distinguishing prefix
 * onto them. The only way to recognize "this log file is ours" across a
 * process restart would be to persist a registry of playground-created
 * codes to disk ourselves, which this module intentionally does not do:
 * the safety requirement ("it must be impossible to delete a real game's
 * log") is far easier to guarantee when the registry can never outlive
 * the process that created the codes in the first place. A stray log left
 * behind by a crashed previous process is a cosmetic annoyance (one JSON
 * file); deleting a real game's log by misidentifying it would not be.
 *
 * Within a single process this still earns its keep: it clears logs for
 * any sandbox that ended and was garbage-collected/destroyed through a
 * path that didn't already clean up after itself.
 */
export function sweepOrphanLogs() {
  for (const code of createdCodes) {
    const stillLive = [...sandboxes.values()].some(s => s.code === code);
    if (stillLive) continue;
    try { deleteGameLog(code); } catch { /* best effort */ }
  }
}

// ── Sandbox object ─────────────────────────────────────────────────────

function buildSandbox({ sessionId, code, hostCode, manager, rng, seed }) {
  const createdAt = Date.now();
  /** @type {{label:string|null, at:number, index:number, buffer:Buffer}[]} */
  const snapshots = [];
  let mutexTail = Promise.resolve();

  const sandbox = {
    sessionId,
    code,
    hostCode,
    manager,
    rng,
    seed,
    createdAt,

    // Single per-sandbox async mutex: every mutation/resolution funnels
    // through here so only one operation is ever mid-flight at a time.
    // `fn` is synchronous (so is the whole engine) — `run` just serializes
    // access to it. This matters because trace.js's capture has a
    // re-entrancy guard that assumes nothing else is mid-flight.
    run(fn) {
      const result = mutexTail.then(() => {
        const value = fn(sandbox);
        // Game-log litter cleanup (file header). Every mutation passes
        // through here, so this is the one place that reliably catches
        // "did this operation just end the game" — without needing to
        // special-case every call site (torture/lynch/night-kill/
        // adminEndGame) that can trigger finishIfWon()/adminEndGame()
        // internally.
        const g = manager.game(code);
        if (g && g.status === 'ended') {
          try { deleteGameLog(code); } catch { /* best effort */ }
        }
        return value;
      });
      mutexTail = result.then(() => undefined, () => undefined);
      return result;
    },

    // Force-resolves the current phase. The injected clock is frozen (file
    // header point 2), so every deadline check in resolve() would
    // otherwise reject with "Phase is active" forever — force:true is the
    // playground's normal mode of operation, not an escape hatch.
    resolve(force = true) {
      return manager.resolve(code, force);
    },

    // Writes phase/round/day_stage directly. Deliberately NOT
    // manager.setPhase() (heresyGameManager.js:777), which has side
    // effects — a system chat message, bot prompts, and a bulk tier-1
    // cripple-recovery UPDATE — none of which belong to an arbitrary state
    // jump the playground operator is dialing in by hand.
    forcePhase(phase, round, dayStage = null) {
      if (!['lobby', 'day', 'night', 'ended'].includes(phase)) {
        throw new Error(`Invalid phase "${phase}"`);
      }
      manager.db.prepare('UPDATE hr_games SET phase=?,round=?,day_stage=?,updated_at=? WHERE code=?')
        .run(phase, round, dayStage, manager.now(), code);
      return manager.game(code);
    },

    // Explicit opt-in to the engine's own setPhase(), side effects and all
    // — for when a caller actually wants the system message/bot prompts
    // that forcePhase() deliberately skips.
    applyPhase(phase, round, dayStage = null) {
      manager.setPhase(code, phase, round, dayStage);
      return manager.game(code);
    },

    // The engine's sanctioned admin path (heresyGameManager.js:1382).
    // Clamps drift to [0,max_drift] and cripple tier to [0,3] — the
    // returned row is the value AFTER clamping, so callers can see what
    // actually landed.
    updatePlayer(playerCode, updates = {}) {
      return manager.adminUpdatePlayer(code, playerCode, updates);
    },

    // Escape hatch for the hr_players columns adminUpdatePlayer() doesn't
    // cover. Column names come only from the RAW_PLAYER_FIELDS whitelist
    // above — never from the caller.
    setPlayerRaw(playerCode, updates = {}) {
      manager.requirePlayer(code, playerCode);
      applyRawFields(manager.db, 'hr_players', 'game_code=? AND player_code=?', [code, playerCode], RAW_PLAYER_FIELDS, updates);
      return manager.player(code, playerCode);
    },

    // Escape hatch for the hr_games columns start()/configure() don't
    // cover. Same whitelist discipline as setPlayerRaw.
    setGameFields(updates = {}) {
      manager.requireGame(code);
      applyRawFields(manager.db, 'hr_games', 'code=?', [code], RAW_GAME_FIELDS, updates, manager.now());
      return manager.game(code);
    },

    // hr_usage counters (ability-use counts read by submitAction's
    // once-per-game gates). `ability` is a parameterized data value here,
    // not a column name, so it needs no separate whitelist — the upsert
    // shape itself is fixed.
    setUsage(playerCode, ability, uses) {
      manager.db.prepare(
        'INSERT INTO hr_usage(game_code,player_code,ability,uses) VALUES(?,?,?,?) ' +
        'ON CONFLICT(game_code,player_code,ability) DO UPDATE SET uses=excluded.uses'
      ).run(code, playerCode, String(ability), Math.max(0, Number(uses) || 0));
      return manager.usage(code, playerCode, ability);
    },

    listPlayerCodes() {
      return manager.players(code).map(p => ({
        playerCode: p.player_code,
        name: p.name,
        seat: p.seat,
        isHost: p.player_code === hostCode,
      }));
    },

    // Pushes a full DB snapshot onto the stack and returns a descriptor —
    // never the Buffer itself (callers get history()/the return value for
    // bookkeeping, never the raw bytes). Safe only because the manager
    // caches zero prepared statements — see file header for the verified
    // claim and the grep that backs it.
    snapshot(label) {
      const buffer = manager.db.serialize();
      const entry = { label: label ?? null, at: Date.now(), index: snapshots.length, buffer };
      snapshots.push(entry);
      return { label: entry.label, at: entry.at, index: entry.index };
    },

    // Pops (consumes) the most recent snapshot and restores the DB to it.
    // Popping rather than peeking: repeated rewind() calls walk backward
    // through history one step at a time instead of bouncing off the same
    // point forever. Call snapshot() again first if the current state
    // should stay reachable after rewinding.
    rewind() {
      const entry = snapshots.pop();
      if (!entry) throw new Error('No snapshot to rewind to');
      // The exact better-sqlite3 Database class the engine's own `db` is
      // an instance of — avoids importing better-sqlite3 a second time
      // (a second native build in playground/node_modules, real version-
      // skew risk). See file header for the prepared-statement-caching
      // argument for why swapping manager.db like this is safe.
      const Database = manager.db.constructor;
      manager.db.close();
      manager.db = new Database(entry.buffer);
      return { label: entry.label, at: entry.at, index: entry.index };
    },

    // Descriptors only (label/at/index) — never the buffers.
    history() {
      return snapshots.map(({ buffer, ...rest }) => rest);
    },

    close() {
      // Idempotent and self-deregistering, so it behaves the same whether
      // invoked via destroySandbox(sessionId) or directly on a Sandbox
      // object a caller is already holding — either way, no dangling
      // registry entry survives to crash listSandboxes()/getSandbox() on a
      // closed db handle.
      if (!sandboxes.has(sessionId)) return;
      sandboxes.delete(sessionId);
      try { deleteGameLog(code); } catch { /* best effort — see file header */ }
      manager.db.close();
    },
  };

  return sandbox;
}
