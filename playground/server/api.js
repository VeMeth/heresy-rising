/**
 * api.js — the playground's HTTP surface. A thin translation layer: every
 * handler below either reads (calls straight into `manager`/sandbox helpers,
 * synchronously, no mutex needed) or mutates (funnelled through
 * `sandbox.run()`, per sandbox.js's file header — "every mutation and
 * resolution goes through it").
 *
 * This file owns exactly one job beyond routing: shaping the wire format so
 * it matches what playground/client/src is already coded against (see the
 * per-route comments below for the handful of places where the engine's own
 * field names had to be aliased or normalized for the client's benefit).
 * Never invent new persistence or game logic here — every mutation must
 * bottom out in an existing sandbox/manager/scenario/exportTest call.
 */

import express from 'express';
import { createSandbox, getSandbox, listSandboxes, destroySandbox, sweepOrphanLogs } from './sandbox.js';
import { captureResolution } from './trace.js';
import { listScenarios, saveScenario, loadScenario, applyScenario } from './scenarios.js';
import { exportTest } from './exportTest.js';
import { loadGameConfig } from '../../heresy-server/src/gameConfig.js';

// ── error helpers ──────────────────────────────────────────────────────────

/** Tag a plain Error with an HTTP status so the error middleware honours it. */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const badRequest = (message) => httpError(400, message);
const notFound = (message) => httpError(404, message);

// ── short codes ─────────────────────────────────────────────────────────
//
// Player codes are `${sessionId}-p${seat}` (sandbox.js:371, seat 1-indexed),
// where sessionId is itself a UUID — so every code is a wall of hex before a
// short, human-scannable `pN` tail (N matches the seat number and the
// default "P1".."PN" player names, so codes and names align). Every table in
// the client renders one
// of these per row/cell, which makes the whole board unscannable at a
// glance (the tool's entire point). `shortCode` pulls just the trailing
// seat segment; splitting on '-' and taking the last piece is safe because
// the seat suffix is the only dash-delimited segment that isn't itself a
// slice of the UUID. The FULL code still travels in every API call and
// every DOM `value`/key — this is a display-only derivation.
function shortCode(playerCode) {
  return typeof playerCode === 'string' ? playerCode.split('-').pop() : playerCode;
}

/**
 * Classify an error into a status code when the throw site didn't already
 * tag one (via requireSandbox/badRequest/notFound above).
 *
 * The engine (heresyGameManager.js) signals a rejected operation by
 * throwing a plain `new Error('human message')` — "Torture damage blocks
 * this action", "Voting is closed", "Blood Ritual has already been claimed
 * tonight", etc. That message IS the user interface (per the dispatch), so
 * it must reach the client verbatim rather than being replaced with a
 * generic string. Every one of those is a deliberate business-rule
 * rejection against otherwise well-formed input, which maps to 409.
 *
 * A genuine bug in THIS file (a null-deref, a typo) throws a native
 * TypeError/ReferenceError/RangeError instead — Node's own runtime errors,
 * never something heresyGameManager.js constructs — so those are the one
 * class of error this router can reliably tell apart from an engine
 * rejection without a bespoke marker on every engine throw site. Those get
 * 500 and a server-side log line; everything else defaults to 409.
 */
function statusFor(err) {
  if (err && Number.isInteger(err.status)) return err.status;
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError) {
    return 500;
  }
  return 409;
}

/** Wrap an async route handler so a throw (sync or via a rejected promise) becomes a clean JSON error instead of an unhandled 500/hang. */
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireSandbox(id) {
  const sandbox = getSandbox(id);
  if (!sandbox) throw notFound(`Session not found: ${id}`);
  return sandbox;
}

// ── player/game field aliasing ──────────────────────────────────────────
//
// RosterTable.vue (the state editor) emits update-player/update-game events
// keyed by the exact DB-flavoured names it renders (snake_case flags like
// `tortured_before`, and `patient_zero` for the game row) because that's
// what the roster editor's job is — a raw state editor, not a redacted
// player-facing view. Those names don't line up 1:1 with the sandbox's own
// method parameter names (adminUpdatePlayer's camelCase `roleId`/
// `skipNextNight`, RAW_PLAYER_FIELDS' camelCase keys, RAW_GAME_FIELDS'
// `patientZero`) — these maps bridge that gap in one place instead of
// scattering `updates.tortured_before ?? updates.torturedBefore` checks
// through every handler.

const PLAYER_UPDATE_ALIASES = {
  role: 'roleId',
  tortured_before: 'torturedBefore',
  mark_public: 'markPublic',
  possessed_by: 'possessedBy',
  possession_revealed: 'possessionRevealed',
  plague_carrier: 'plagueCarrier',
  tier1_until_round: 'tier1UntilRound',
  skip_next_night: 'skipNextNight',
  death_cause: 'deathCause',
  display_order: 'displayOrder',
};
// sandbox.updatePlayer() -> manager.adminUpdatePlayer() — clamps drift/cripple, validates faction/roleId.
const ADMIN_PLAYER_KEYS = new Set(['alive', 'ready', 'connected', 'skipNextNight', 'drift', 'crippleTier', 'faction', 'roleId']);
// sandbox.setPlayerRaw() -> RAW_PLAYER_FIELDS whitelist in sandbox.js.
const RAW_PLAYER_KEYS = new Set(['torturedBefore', 'markPublic', 'possessedBy', 'possessionRevealed', 'plagueCarrier', 'tier1UntilRound', 'deathCause', 'seat', 'displayOrder']);

function normalizeKeys(updates, aliases) {
  const out = {};
  for (const [k, v] of Object.entries(updates || {})) {
    out[aliases[k] || k] = v;
  }
  return out;
}

const GAME_UPDATE_ALIASES = { patient_zero: 'patientZero' };

// ── response shaping ────────────────────────────────────────────────────
//
// The client needs the SAME player identified by two different key names
// depending on which component reads it: RosterTable.vue uses
// `p.playerCode` throughout, while ActionPanel.vue/VotePanel.vue/
// FogView.vue all read `p.code`. Rather than pick one and silently break
// the other panel, every player object below carries both as aliases of
// the same value.

/** Build the full per-player projection for GET /api/session/:id. */
function buildPlayers(sandbox) {
  const { manager, code } = sandbox;
  const admin = manager.adminState(code);
  const adminByCode = new Map(admin.players.map((p) => [p.playerCode, p]));
  const raw = manager.players(code); // raw hr_players rows, seat order — the source of truth for the flags adminState() doesn't project
  return raw.map((r) => {
    const a = adminByCode.get(r.player_code) || {};
    return {
      ...a,
      playerCode: r.player_code,
      code: r.player_code, // alias — see header comment
      shortCode: shortCode(r.player_code), // display-only — see shortCode() above
      // adminState()'s `role` is the full rendered role object (roleForDisplay); the roster
      // editor's <select> and ActionPanel's roleMap both key off the plain role id string
      // instead, matching what GET /api/roles hands back as `roles[].id`.
      role: r.role_id || null,
      roleId: r.role_id || null,
      // Raw hr_players columns the roster editor needs verbatim (dispatch shape note) —
      // snake_case exactly as the DB stores them, since that's the key RosterTable.vue reads.
      tortured_before: !!r.tortured_before,
      mark_public: !!r.mark_public,
      possessed_by: r.possessed_by || null,
      possession_revealed: !!r.possession_revealed,
      plague_carrier: !!r.plague_carrier,
      tier1_until_round: r.tier1_until_round ?? null,
      skip_next_night: !!r.skip_next_night,
      death_cause: r.death_cause || null,
      seat: r.seat,
      display_order: r.display_order,
      isBot: !!r.is_bot,
    };
  });
}

/** Project a raw hr_games row into the camelCase (+ a couple of snake_case aliases the editor reads) shape RosterTable.vue/ActionPanel.vue/VotePanel.vue expect. */
function projectGame(g) {
  if (!g) return null;
  return {
    ...g, // keep every raw column too (day_stage, max_drift, patient_zero, ...) for completeness/debugging
    phase: g.phase,
    round: g.round,
    dayStage: g.day_stage,
    status: g.status,
    deadline: g.deadline,
    maxDrift: g.max_drift,
    dayMs: g.day_ms,
    nightMs: g.night_ms,
    winner: g.winner,
    anonymized: !!g.anonymized,
    warpTaintVisible: !!g.warp_taint_visible,
    deathReveal: g.death_reveal,
    dayStartMinuteUtc: g.day_start_minute_utc,
    patient_zero: g.patient_zero ?? null, // RosterTable.vue reads this exact snake_case key
    lastTorturedTarget: g.last_tortured_target,
    lastTortureTier: g.last_torture_tier,
    hintProfile: g.hint_profile,
  };
}

/** The full omniscient board GET /api/session/:id (and POST /api/session's response) hand back. */
function buildSessionState(sandbox) {
  const { manager, code, sessionId, hostCode, seed } = sandbox;
  const game = manager.game(code);
  const round = game.round;
  const actionsRaw = manager.db
    .prepare('SELECT actor_code AS actorCode, kind, target_code AS targetCode, variant, data, created_at AS createdAt FROM hr_actions WHERE game_code=? AND round=? ORDER BY created_at')
    .all(code, round);
  // `faction: true` is synthesized here (hr_actions has no such column) so ActionPanel.vue's
  // bloodRitualClaim/describeAction — which key off `action.faction`, mirroring the shape the
  // client sends when it SUBMITS a Blood Ritual — can recognise one in what comes back too.
  const actions = actionsRaw.map((a) => ({ ...a, data: a.data ? JSON.parse(a.data) : null, faction: a.kind === 'blood-ritual' }));
  const votes = manager.db
    .prepare("SELECT voter_code AS voterCode, choice, justification, stage, created_at AS createdAt FROM hr_votes WHERE game_code=? AND round=? ORDER BY created_at")
    .all(code, round);
  return {
    id: sessionId,
    sessionId,
    code,
    hostCode,
    seed,
    game: projectGame(game),
    players: buildPlayers(sandbox),
    actions,
    votes,
    history: sandbox.history(),
  };
}

/** GET /api/session/:id/view/:code's fog projection, with the same `code` alias buildPlayers() adds — FogView.vue reads `p.code` off view.players too. */
function buildView(sandbox, playerCode) {
  const view = sandbox.manager.state(sandbox.code, playerCode);
  const players = (view.players || []).map((p) => ({ ...p, code: p.playerCode, shortCode: shortCode(p.playerCode) }));
  const me = view.me ? { ...view.me, code: view.me.playerCode, shortCode: shortCode(view.me.playerCode) } : null;
  return { ...view, players, me };
}

// ── router ──────────────────────────────────────────────────────────────
//
// createPlaygroundRouter() is the mountable unit: an express.Router with NO
// body-parser of its own and paths relative to wherever it's mounted (e.g.
// `/roles`, not `/api/roles`) — the mount point supplies both. Two callers:
//   - createApp() below: standalone entry (index.js), mounts it at `/api`
//     with a 2mb json parser, reproducing the exact `/api/...` surface this
//     file has always served — behaviour-identical to before this split.
//   - heresy-server/src/index.js: mounts it at `/api/playground`, behind
//     requireAdmin and its own json parser, so the playground is reachable
//     from the real site without duplicating a single route or handler.
export function createPlaygroundRouter() {
  const router = express.Router();

  // -- roles --------------------------------------------------------------

  // NOTE ON SHAPE: the dispatch's route table documents this as
  // `-> {roles, drift, rules}`. But playground/client/src/App.vue does
  // `roles.value = rolesRes ?? []` — it assigns the raw response body
  // directly as the roles array, and every consumer (SetupPanel.vue,
  // RosterTable.vue, ActionPanel.vue) declares that prop `Array`. A
  // `{roles,...}` wrapper would hand those components an object, and the
  // first `.filter()`/`.find()` call on it throws — the whole app fails to
  // render past Setup. Since "the client is already coded against these
  // routes" is the given premise, this serves the bare array roleList()
  // returns instead, matching what actually runs. `drift`/`rules` are
  // dropped from this response as a result — nothing in the client reads
  // them off GET /api/roles today. Flagged in the handoff notes; trivial to
  // switch back (wrap in `{roles: ..., drift, rules}`) if App.vue's
  // assignment line is updated to unwrap it.
  router.get('/roles', asyncRoute(async (req, res) => {
    const cfg = loadGameConfig();
    res.json(cfg.roleList);
  }));

  // -- session lifecycle ----------------------------------------------------

  router.post('/session', asyncRoute(async (req, res) => {
    const { players, roster, seed, options } = req.body || {};
    if (!Array.isArray(players) || !players.length) throw badRequest('players must be a non-empty array');
    if (!Array.isArray(roster) || !roster.length) throw badRequest('roster must be a non-empty array');
    const sandbox = createSandbox({ players, roster, seed, options });
    const state = buildSessionState(sandbox);
    // Both flattened (client's `session.id`) and the dispatch-documented
    // `{sessionId, state}` envelope, so either consumer is satisfied.
    res.status(201).json({ ...state, state });
  }));

  router.get('/session/:id', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    res.json(buildSessionState(sandbox));
  }));

  router.patch('/session/:id/player/:code', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const normalized = normalizeKeys(req.body?.updates, PLAYER_UPDATE_ALIASES);
    const adminUpdates = {};
    const rawUpdates = {};
    for (const [k, v] of Object.entries(normalized)) {
      if (ADMIN_PLAYER_KEYS.has(k)) adminUpdates[k] = v;
      else if (RAW_PLAYER_KEYS.has(k)) rawUpdates[k] = v;
      // Unknown keys are silently dropped — this is a debug tool fed by a
      // fixed set of client controls, not an open write surface.
    }
    await sandbox.run(() => {
      sandbox.manager.requirePlayer(sandbox.code, req.params.code); // 409 with the engine's own "Not a member" if the code is bogus
      if (Object.keys(adminUpdates).length) sandbox.updatePlayer(req.params.code, adminUpdates);
      if (Object.keys(rawUpdates).length) sandbox.setPlayerRaw(req.params.code, rawUpdates);
    });
    const player = buildPlayers(sandbox).find((p) => p.playerCode === req.params.code);
    res.json(player);
  }));

  router.patch('/session/:id/game', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const normalized = normalizeKeys(req.body?.updates, GAME_UPDATE_ALIASES);
    await sandbox.run(() => {
      sandbox.setGameFields(normalized);
    });
    res.json(projectGame(sandbox.manager.game(sandbox.code)));
  }));

  // -- actions & votes -------------------------------------------------------

  router.post('/session/:id/action', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const { actorCode, targetCode, variant, data, faction, retract } = req.body || {};
    if (!actorCode) throw badRequest('actorCode is required');

    const result = await sandbox.run(() => {
      if (retract) {
        sandbox.manager.retractAction(sandbox.code, actorCode);
        return { retracted: true };
      }
      if (faction) {
        return sandbox.manager.submitFactionAction(sandbox.code, actorCode, { targetCode });
      }

      // Forgery quirk: the Conspirator's day action needs `body`/`asPlayerCode`,
      // which the client's fixed action-submission shape has no room for — it
      // sends who-to-impersonate as targetCode and the forged text as
      // data.body (see ActionPanel.vue's submitForgery). submitAction() only
      // ever reads params.asPlayerCode/body when the ACTOR'S OWN role.actions
      // for the current phase resolves to kind==='forgery' (heresyGameManager
      // .js:1218) — so that's determined here from the actor's actual role,
      // not guessed from the request shape.
      const g = sandbox.manager.requireGame(sandbox.code);
      const actor = sandbox.manager.requirePlayer(sandbox.code, actorCode);
      const role = actor.role_id ? sandbox.manager.role(actor.role_id) : null;
      const dayKind = role?.actions?.day?.kind;
      if (g.phase === 'day' && dayKind === 'forgery') {
        return sandbox.manager.submitAction(sandbox.code, actorCode, {
          targetCode,
          variant,
          data,
          asPlayerCode: targetCode,
          body: data && typeof data === 'object' ? data.body : undefined,
        });
      }

      // Return the engine's return value VERBATIM — see the `silent:true`
      // case in particular: submitAction() returns {kind, targetCode,
      // silent:true} for a torture-crippled actor submitting protect/
      // bodyguard/drift-hint/warp-read, without writing an hr_actions row.
      // That flag is the one and only moment this drop is observable (at
      // resolve time it's byte-identical to a genuine sleep) — ActionPanel.vue
      // keeps it keyed by actor and badges it, so it must survive this hop
      // unmodified.
      return sandbox.manager.submitAction(sandbox.code, actorCode, { targetCode, variant, data });
    });
    res.json(result);
  }));

  router.post('/session/:id/vote', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const { voterCode, choice, justification, retract } = req.body || {};
    if (!voterCode) throw badRequest('voterCode is required');
    const result = await sandbox.run(() => {
      if (retract) {
        return sandbox.manager.retractVote(sandbox.code, voterCode);
      }
      return sandbox.manager.vote(sandbox.code, voterCode, choice, justification);
    });
    res.json(result);
  }));

  // -- resolution & fog -----------------------------------------------------

  router.post('/session/:id/resolve', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const trace = await sandbox.run(() => captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng }));
    // Strip snapshotBefore defensively — a raw SQLite image in the JSON body
    // would bloat the response enormously. trace.js's build() doesn't
    // currently set this key, but the contract is "never let one leak",
    // not "trust today's trace.js never to grow one".
    const { snapshotBefore, ...clean } = trace || {};
    res.json(clean);
  }));

  router.get('/session/:id/view/:code', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    res.json(buildView(sandbox, req.params.code));
  }));

  // -- snapshots, history -----------------------------------------------

  router.post('/session/:id/snapshot', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const { label } = req.body || {};
    const result = await sandbox.run(() => sandbox.snapshot(label));
    res.status(201).json(result);
  }));

  router.post('/session/:id/rewind', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const result = await sandbox.run(() => sandbox.rewind());
    res.json(result);
  }));

  router.get('/session/:id/history', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    res.json(sandbox.history());
  }));

  // -- scenarios & export ----------------------------------------------------

  router.get('/scenarios', asyncRoute(async (req, res) => {
    res.json(listScenarios());
  }));

  router.post('/scenarios', asyncRoute(async (req, res) => {
    const { name, sessionId, description } = req.body || {};
    if (!name) throw badRequest('name is required');
    const sandbox = requireSandbox(sessionId);
    res.status(201).json(saveScenario(name, sandbox, { description }));
  }));

  router.post('/session/:id/load', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const { name } = req.body || {};
    if (!name) throw badRequest('name is required');
    let doc;
    try {
      doc = loadScenario(name);
    } catch (err) {
      throw notFound(err.message);
    }
    await sandbox.run(() => applyScenario(sandbox, doc));
    res.json(buildSessionState(sandbox));
  }));

  // Opens a scenario in a brand-new sandbox — what the playground client's
  // "Load" button calls. Distinct from POST /session/:id/load (which applies
  // onto an existing sandbox; the API exposes both so callers can pick):
  // POST /session/from-scenario is the no-preconditions entry, used when
  // there's no session yet to load into, which is exactly the playground
  // client's primary "Load" flow. Creates a fresh sandbox from the scenario's
  // saved players/roster/seed/options, replays the doc onto it (so flags,
  // drift, cripple tier, sub-round actions/votes/usage are restored), and
  // returns the same buildSessionState shape POST /session does.
  router.post('/session/from-scenario', asyncRoute(async (req, res) => {
    const { name } = req.body || {};
    if (!name) throw badRequest('name is required');
    let doc;
    try {
      doc = loadScenario(name);
    } catch (err) {
      throw notFound(err.message);
    }
    const players = doc.players.map((p) => ({ name: p.name }));
    const roster = doc.players.map((p) => p.roleId);
    const sandbox = createSandbox({
      players,
      roster,
      seed: doc.seed,
      options: {
        maxDrift: doc.options?.maxDrift,
      },
    });
    await sandbox.run(() => applyScenario(sandbox, doc));
    const state = buildSessionState(sandbox);
    res.status(201).json({ ...state, state });
  }));

  router.post('/session/:id/export-test', asyncRoute(async (req, res) => {
    const sandbox = requireSandbox(req.params.id);
    const { name, description } = req.body || {};
    if (!name) throw badRequest('name is required');
    res.status(201).json(exportTest({ sandbox, name, description }));
  }));

  // Unmatched route within this router's mount — kept on the router (not
  // the host app) so an embedded mount (e.g. heresy-server's /api/playground)
  // only 404s its OWN sub-tree instead of swallowing every other unmatched
  // route on the host app.
  router.use((req, res) => {
    res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
  });

  // Final error boundary. Catches: badRequest/notFound (tagged .status),
  // engine rejections (statusFor's 409 default), express.json()'s own
  // SyntaxError on malformed JSON bodies (body-parser tags .status/.statusCode
  // 400 on those already), and genuine bugs (500, logged server-side —
  // never shown to the client raw). Express supports error-handling
  // middleware on a Router exactly like on an app, so this stays scoped to
  // playground routes the same way the 404 handler above does — an error
  // thrown by heresy-server's OWN routes never reaches this handler.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const status = err.status || err.statusCode || statusFor(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return router;
}

/**
 * Standalone entry point's app (playground/server/index.js). Reproduces the
 * exact `/api/...` surface + 2mb body limit this file served before the
 * createPlaygroundRouter() split — behaviour here must never change.
 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createPlaygroundRouter());
  return app;
}

// Re-exported so index.js's graceful shutdown can enumerate and close every
// live sandbox without reaching into sandbox.js's private registry itself.
export { listSandboxes, destroySandbox, sweepOrphanLogs };
