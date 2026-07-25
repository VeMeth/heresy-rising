/**
 * Game runner — single-game loop and batch runner.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { HeresyGameManager } from '../../heresy-server/src/heresyGameManager.js';
import { seedableRNG } from './util.js';
import {
  buildAgentState,
  createHeuristicAgent,
  collectNightActions,
  collectDayVotes,
  collectInterrogationResponses,
} from './agent.js';
import { createRandomAgent } from './strategies/random.js';

// ── Single game ────────────────────────────────────────────────────────────

/**
 * Run a single game to completion.
 * @param {Object} options
 * @param {number} options.playerCount - Number of players (5-12)
 * @param {number} [options.seed] - RNG seed
 * @param {boolean} [options.verbose] - Print every action
 * @param {number} [options.maxRounds] - Abort after this many rounds
 * @param {'random'|'heuristic'} [options.strategy] - Agent strategy type
 * @returns {Object} { winner, rounds, players, composition, seed }
 */
export function runSingleGame(options = {}) {
  const {
    playerCount = 8,
    seed = Date.now(),
    verbose = false,
    maxRounds = 50,
    strategy = 'heuristic',
  } = options;

  const rng = seedableRNG(seed);
  const clock = 1_000_000; // Fixed virtual clock

  // Monkey-patch Math.random with seeded RNG for engine determinism.
  // The engine's shuffle() uses Math.random() — we patch it here.
  const origMathRandom = Math.random;
  Math.random = rng;

  // Create temp dir for DB
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-sim-'));
  const dbPath = path.join(dir, 'game.db');

  const manager = new HeresyGameManager({
    databasePath: dbPath,
    now: () => clock,
    random: rng,
  });

  try {
    // Create game
    const hostCode = 'sim-host';
    const { code } = manager.create({ playerCode: hostCode, name: 'Simulator' });

    // Spawn agents
    const agents = new Map();
    const playerCodes = [hostCode];
    const factionState = new Map(); // Shared state for heretic coordination

    // Join agents
    for (let i = 1; i < playerCount; i++) {
      const playerCode = `sim-p${i}`;
      playerCodes.push(playerCode);
      manager.join({ code, playerCode, name: `P${i}` });
      manager.ready(code, playerCode, true);
    }

    // Create agents (we don't know roles yet — assign after start)
    // Use placeholder agents for now, we'll assign heuristics after start
    for (const pc of playerCodes) {
      agents.set(pc, null); // Will be assigned after role reveal
    }

    // Start game
    manager.start(code, hostCode);

    // Now we know roles — assign heuristic agents
    const rawPlayers = manager.players(code);
    for (const p of rawPlayers) {
      if (strategy === 'heuristic') {
        agents.set(p.player_code, createHeuristicAgent(p.role_id, p.player_code, factionState));
      } else {
        agents.set(p.player_code, createRandomAgent(p.player_code));
      }
    }

    if (verbose) {
      console.log(`\nGame ${code} started with ${playerCount} players (seed ${seed})`);
      for (const p of rawPlayers) {
        console.log(`  ${p.name}: ${p.role_id} (${p.faction})`);
      }
    }

    // Game loop
    let game = manager.game(code);
    let rounds = 0;

    while (game.status === 'active' && rounds < maxRounds) {
      rounds++;

      if (game.phase === 'night') {
        if (verbose) console.log(`\n--- Night ${game.round} ---`);

        // Collect and submit night actions
        collectNightActions(manager, code, agents, verbose);

        // Resolve night
        manager.resolve(code, true);
        game = manager.game(code);

      } else if (game.phase === 'day') {
        if (verbose) console.log(`\n--- Day ${game.round} ---`);

        if (game.round === 1) {
          // Day 1: no vote, advance immediately (Q28)
          if (verbose) console.log('  Day 1: No vote (Q28), advancing...');
          manager.advance(code, hostCode);
        } else {
          // Check if we're in the response stage
          if (game.day_stage === 'response') {
            if (verbose) console.log('  Interrogation response stage');
            collectInterrogationResponses(manager, code, agents, verbose);
            // After response, advance to next phase
            manager.advance(code, hostCode);
          } else {
            // Normal voting stage
            collectDayVotes(manager, code, agents, verbose);
            // Advance to resolve day
            manager.advance(code, hostCode);
          }
        }

        game = manager.game(code);
      } else {
        // Unknown phase — break
        break;
      }

      // Re-fetch game state
      game = manager.game(code);
    }

    // Collect results
    game = manager.game(code);
    const finalPlayers = manager.players(code);

    if (verbose) {
      console.log(`\n=== Game Over ===`);
      console.log(`Winner: ${game.winner || 'draw'}`);
      console.log(`Rounds: ${game.round}`);
      if (game.status !== 'ended') {
        console.log(`Status: ${game.status} (max rounds reached)`);
      }
    }

    return {
      winner: game.winner || 'draw',
      rounds: game.round,
      status: game.status,
      composition: finalPlayers.map(p => ({ playerCode: p.player_code, roleId: p.role_id, faction: p.faction })),
      players: finalPlayers.map(p => ({
        playerCode: p.player_code,
        name: p.name,
        roleId: p.role_id,
        faction: p.faction,
        alive: !!p.alive,
        drift: p.drift,
        crippleTier: p.cripple_tier,
        confessed: !!p.confessed,
      })),
      seed,
    };
  } finally {
    manager.close();
    Math.random = origMathRandom; // Restore original Math.random
    // Clean up temp dir
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Batch runner ───────────────────────────────────────────────────────────

/**
 * Run N games sequentially and collect results.
 * @param {Object} options
 * @param {number} options.games - Number of games
 * @param {number} options.playerCount - Players per game
 * @param {number} [options.seed] - Base RNG seed
 * @param {'random'|'heuristic'} [options.strategy]
 * @param {number} [options.maxRounds]
 * @returns {Object} Results object
 */
export function runBatch(options = {}) {
  const {
    games = 100,
    playerCount = 8,
    seed = Date.now(),
    strategy = 'heuristic',
    maxRounds = 50,
  } = options;

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < games; i++) {
    const gameSeed = seed + i;
    try {
      const result = runSingleGame({
        playerCount,
        seed: gameSeed,
        verbose: false,
        maxRounds,
        strategy,
      });
      results.push(result);

      // Progress
      if ((i + 1) % 10 === 0 || i === games - 1) {
        const elapsed = Date.now() - startTime;
        const rate = ((i + 1) / elapsed * 1000).toFixed(1);
        process.stderr.write(`\rGames: ${i + 1}/${games} (${rate} games/sec)${' '.repeat(10)}`);
      }
    } catch (err) {
      process.stderr.write(`\nGame ${i} failed: ${err.message}\n`);
    }
  }

  process.stderr.write('\n');

  const elapsed = Date.now() - startTime;
  return {
    meta: {
      simVersion: '1.0.0',
      timestamp: new Date().toISOString(),
      seed,
      playerCount,
      gameCount: results.length,
      strategyMix: { [strategy]: 100 },
    },
    results,
    elapsed,
  };
}

// ── Parallel batch runner ──────────────────────────────────────────────────

/**
 * Run N games across multiple worker threads.
 * Falls back to sequential if workers === 1.
 * @param {Object} options
 * @param {number} options.games - Number of games
 * @param {number} options.playerCount - Players per game
 * @param {number} [options.seed] - Base RNG seed
 * @param {'random'|'heuristic'} [options.strategy]
 * @param {number} [options.maxRounds]
 * @param {number} [options.workers] - Number of worker threads (default: os.cpus().length)
 * @returns {Promise<Object>} Results object
 */
export async function runBatchParallel(options = {}) {
  const {
    games = 100,
    playerCount = 8,
    seed = Date.now(),
    strategy = 'heuristic',
    maxRounds = 50,
    workers: requestedWorkers,
  } = options;

  const available = os.cpus().length;
  const workers = Math.min(
    Math.max(1, requestedWorkers ?? available),
    games,
    available
  );

  if (workers <= 1 || games < workers * 2) {
    // Small batches: sequential is faster (no worker-spawn overhead)
    return runBatch({ games, playerCount, seed, strategy, maxRounds });
  }

  const startTime = Date.now();
  const results = new Array(games);
  let completed = 0;

  // Split games evenly across workers
  const perWorker = Math.floor(games / workers);
  const remainder = games % workers;

  const workerPromises = [];
  let offset = 0;

  for (let w = 0; w < workers; w++) {
    const count = perWorker + (w < remainder ? 1 : 0);
    if (count === 0) continue;

    const startIndex = offset;
    offset += count;

    workerPromises.push(
      spawnWorker({
        playerCount,
        baseSeed: seed,
        startIndex,
        count,
        strategy,
        maxRounds,
        onProgress: (n) => {
          completed += n;
          const elapsed = Date.now() - startTime;
          const rate = (completed / elapsed * 1000).toFixed(1);
          process.stderr.write(
            `\rGames: ${completed}/${games} (${rate} games/sec, ${workers} workers)${' '.repeat(10)}`
          );
        },
        onResult: (chunk) => {
          for (const r of chunk.results) {
            const idx = r.seed - seed;
            if (idx >= 0 && idx < games) results[idx] = r;
          }
        },
      })
    );
  }

  await Promise.all(workerPromises);
  process.stderr.write('\n');

  const elapsed = Date.now() - startTime;

  // Count and log errors before filtering
  const filled = results.filter(Boolean);
  const errors = filled.filter(r => r.winner === 'error');
  const valid = filled.filter(r => r.winner !== 'error' && Array.isArray(r.players));

  if (errors.length > 0) {
    process.stderr.write(`\n${errors.length} game(s) failed and will be excluded.\n`);
    process.stderr.write(`  First error: ${errors[0].error}\n`);
  }
  if (valid.length === 0 && errors.length > 0) {
    process.stderr.write(`⚠ WARNING: All ${errors.length} games failed — results are empty.\n`);
  }

  return {
    meta: {
      simVersion: '1.0.0',
      timestamp: new Date().toISOString(),
      seed,
      playerCount,
      gameCount: valid.length,
      strategyMix: { [strategy]: 100 },
      workers,
    },
    results: valid,
    elapsed,
  };
}

/**
 * Spawn a worker thread and return a promise that resolves when it finishes.
 */
function spawnWorker({ playerCount, baseSeed, startIndex, count, strategy, maxRounds, onProgress, onResult }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./worker.js', import.meta.url),
      {
        workerData: { playerCount, baseSeed, startIndex, count, strategy, maxRounds },
      }
    );

    worker.on('message', (msg) => {
      onResult(msg);
      onProgress(msg.count);
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      else resolve();
    });
  });
}
