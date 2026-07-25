/**
 * Worker entrypoint — runs a range of games and posts results back.
 * Loaded by Node.js worker_threads. Not imported directly.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { runSingleGame } from './runner.js';

const {
  playerCount,
  baseSeed,
  startIndex,
  count,
  strategy,
  maxRounds,
} = workerData;

const results = [];

for (let i = 0; i < count; i++) {
  const gameSeed = baseSeed + startIndex + i;
  try {
    const result = runSingleGame({
      playerCount,
      seed: gameSeed,
      verbose: false,
      maxRounds,
      strategy,
    });
    results.push(result);
  } catch (err) {
    results.push({ winner: 'error', seed: gameSeed, error: err.message });
  }
}

parentPort.postMessage({ results, startIndex, count });
