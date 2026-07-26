#!/usr/bin/env node

/**
 * HTTP server entrypoint for the Heresy Rising Simulator.
 *
 * Sibling service to heresy-server (:4100) and bot-manager (:7878) — a third
 * container in the same compose stack (see heresy-sim/Dockerfile, EXPOSE
 * 7879). Exposes one meaningful endpoint, POST /simulate, which runs a batch
 * of simulated games and returns the same results shape the CLI writes to
 * disk (report.js#buildResultsJSON), plus `perComposition` for completeness.
 *
 * This does NOT replace src/index.js (the CLI) — both entrypoints share
 * runner.js/agent.js/report.js and work independently of each other.
 */

import express from 'express';
import crypto from 'node:crypto';
import os from 'node:os';
import { runBatchParallel } from './runner.js';
import { buildResultsJSON, aggregateResults } from './report.js';
import { validateComposition } from '../../heresy-server/src/validators/composition.js';
import { loadGameConfig } from '../../heresy-server/src/gameConfig.js';

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readEnvInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/**
 * Mirrors HeresyGameManager.presetFor() (heresy-server/src/heresyGameManager.js)
 * without needing a live manager/DB — a pure lookup against the same
 * data/composition.json table loadGameConfig() already reads. This is a
 * ~4-line table lookup, not validation logic (that part is delegated to
 * validateComposition() below) — keep it in sync if presetFor ever changes.
 */
function presetFor(count, config) {
  const exact = config.composition[String(count)];
  if (exact) return [...exact];
  const roles = config.composition.fallbackPriority.slice(0, Math.max(0, count - 1));
  while (roles.length < count) roles.push('imperial-citizen');
  return roles.slice(0, count);
}

/**
 * Build the express app. Exported (rather than only side-effecting at import
 * time) so tests can boot multiple independent instances with different
 * env-derived config without spawning real child processes.
 */
export function createSimServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  const gameConfig = loadGameConfig();

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  app.post('/simulate', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    // ── Auth ────────────────────────────────────────────────────────────
    // Fail closed: an unset token must reject ALL requests, never silently
    // accept them. Mirrors bot-manager/src/auth.js's requireManagerAuth.
    const token = process.env.SIM_BYPASS_TOKEN || '';
    if (!token) {
      return res.status(503).json({ error: 'SIM_BYPASS_TOKEN is not configured' });
    }
    const header = req.get('Authorization') || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !constantTimeEquals(provided, token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── Input validation ───────────────────────────────────────────────
    const body = req.body || {};
    const { composition, games, seed } = body;

    if (!composition || typeof composition !== 'object' || Array.isArray(composition)) {
      return res.status(400).json({ error: 'composition is required and must be an object' });
    }
    if (composition.source !== 'preset' && composition.source !== 'custom') {
      return res.status(400).json({ error: 'composition.source must be "preset" or "custom"' });
    }
    if (!Number.isInteger(games) || games <= 0) {
      return res.status(400).json({ error: 'games is required and must be a positive integer' });
    }
    if (seed !== undefined && (typeof seed !== 'number' || !Number.isFinite(seed))) {
      return res.status(400).json({ error: 'seed must be a finite number if provided' });
    }

    let playerCount, roster;
    if (composition.source === 'preset') {
      const match = /^(\d+)/.exec(String(composition.presetId ?? ''));
      if (!match) {
        return res.status(400).json({ error: 'composition.presetId must start with a number, e.g. "8p"' });
      }
      playerCount = parseInt(match[1], 10);
      roster = presetFor(playerCount, gameConfig);
    } else {
      if (!Array.isArray(composition.roster) || composition.roster.length === 0) {
        return res.status(400).json({ error: 'composition.roster must be a non-empty array of role IDs' });
      }
      roster = composition.roster;
      playerCount = roster.length;
    }

    const validation = validateComposition({
      roster,
      playerCount,
      confirmedWarnings: composition.confirmedWarnings || [],
      validRoles: gameConfig.roles,
      hardRules: gameConfig.hardRules,
      source: composition.source,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: 'Invalid composition', details: validation.errors });
    }

    // ── Server-side hard cap, regardless of caller. Defense in depth — Phase
    // 2 (heresy-server) will also cap on its side, but this service must
    // never trust that blindly. ──────────────────────────────────────────
    const hardMax = readEnvInt('SIM_HARD_MAX_GAMES', 1000);
    const clampedGames = Math.min(Math.max(1, games), hardMax);

    // ── Worker count must respect the container's actual CPU allocation,
    // not the host's full core list — os.cpus() ignores cgroup limits. ────
    const maxWorkers = readEnvInt('SIM_MAX_WORKERS', 2);
    const workers = Math.min(os.cpus().length, maxWorkers);

    try {
      const batch = await runBatchParallel({
        games: clampedGames,
        composition,
        seed,
        strategy: 'heuristic',
        maxRounds: 50,
        workers,
      });
      const json = buildResultsJSON(batch.meta, batch.results, batch.elapsed);
      const aggregated = aggregateResults(batch.results);
      return res.status(200).json({ ...json, perComposition: aggregated.perComposition });
    } catch (err) {
      // A batch that fails must never look like a fake "200 OK, 0 games"
      // success — surface a real error (see runner.js's runBatch/runBatchParallel
      // for the guard that turns a fully-failed batch into a thrown Error).
      return res.status(500).json({ error: err.message });
    }
  });

  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = readEnvInt('SIM_PORT', 7879);
  const app = createSimServer();
  const server = app.listen(port, () => {
    console.info(`[heresy-sim] listening on ${port}`);
    if (!process.env.SIM_BYPASS_TOKEN) {
      console.warn('[heresy-sim] WARN: SIM_BYPASS_TOKEN is not set — POST /simulate will reject all requests with 503.');
    }
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
