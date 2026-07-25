#!/usr/bin/env node

/**
 * CLI entrypoint for the Heresy Rising Simulator.
 */

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { runSingleGame, runBatch, runBatchParallel } from './runner.js';
import { buildResultsJSON, formatTextSummary } from './report.js';

const program = new Command();

program
  .name('heresy-sim')
  .description('Heresy Rising batch simulator — runs thousands of games with heuristic AI agents')
  .version('1.0.0');

/** Parse a `--composition` flag value (a JSON string) into a composition object. */
function parseComposition(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`--composition must be valid JSON, e.g. '{"source":"preset","presetId":"8p"}'`);
  }
}

// ── single command ─────────────────────────────────────────────────────────

program
  .command('single')
  .description('Run one game with verbose logging')
  .option('-p, --players <n>', 'Player count 5-12', (v) => parseInt(v), 8)
  .option('--seed <n>', 'RNG seed', (v) => parseInt(v), undefined)
  .option('-v, --verbose', 'Print every action and phase transition', false)
  .option('--max-rounds <n>', 'Abort after N rounds', (v) => parseInt(v), 50)
  .option('--strategy <s>', 'Agent strategy: heuristic|random', 'heuristic')
  .option('--composition <json>', 'Composition override, e.g. \'{"source":"preset","presetId":"8p"}\' (overrides --players)', parseComposition, undefined)
  .action((options) => {
    const start = Date.now();
    try {
      const result = runSingleGame({
        playerCount: options.composition ? undefined : options.players,
        composition: options.composition,
        seed: options.seed ?? Date.now(),
        verbose: options.verbose,
        maxRounds: options.maxRounds,
        strategy: options.strategy,
      });
      const elapsed = Date.now() - start;

      console.log(`\nWinner: ${result.winner}`);
      console.log(`Rounds: ${result.rounds}`);
      console.log(`Time: ${elapsed}ms`);
      console.log(`Seed: ${result.seed}`);

      if (options.verbose) {
        console.log('\nFinal state:');
        for (const p of result.players) {
          const status = p.alive ? 'alive' : 'dead';
          const drift = p.drift > 0 ? ` drift:${p.drift}` : '';
          const cripple = p.crippleTier > 0 ? ` cripple:T${p.crippleTier}` : '';
          console.log(`  ${p.name}: ${p.roleId} (${p.faction}) ${status}${drift}${cripple}`);
        }
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── run command ────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run batch simulation')
  .option('-g, --games <n>', 'Number of games to simulate', (v) => parseInt(v), 100)
  .option('-p, --players <n>', 'Player count 5-12', (v) => parseInt(v), 8)
  .option('--seed <n>', 'RNG seed', (v) => parseInt(v), undefined)
  .option('--output <dir>', 'Output directory', './sim-results/')
  .option('--max-rounds <n>', 'Abort game after N rounds', (v) => parseInt(v), 50)
  .option('--strategy <s>', 'Agent strategy: heuristic|random', 'heuristic')
  .option('--parallel <n>', 'Number of worker threads (default: CPU count)', (v) => parseInt(v), undefined)
  .option('--composition <json>', 'Composition override, e.g. \'{"source":"preset","presetId":"8p"}\' (overrides --players)', parseComposition, undefined)
  .action(async (options) => {
    const start = Date.now();
    try {
      const workers = options.parallel ?? undefined;
      const playerCount = options.composition ? undefined : options.players;
      const result = workers === 1
        ? runBatch({
            games: options.games,
            playerCount,
            composition: options.composition,
            seed: options.seed ?? Date.now(),
            strategy: options.strategy,
            maxRounds: options.maxRounds,
          })
        : await runBatchParallel({
            games: options.games,
            playerCount,
            composition: options.composition,
            seed: options.seed ?? Date.now(),
            strategy: options.strategy,
            maxRounds: options.maxRounds,
            workers,
          });

      const elapsed = Date.now() - start;

      // Build and write JSON output
      const outputDir = path.resolve(options.output);
      fs.mkdirSync(outputDir, { recursive: true });

      const json = buildResultsJSON(result.meta, result.results, result.elapsed);
      const jsonPath = path.join(outputDir, 'results.json');
      fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));

      // Print summary
      const summary = formatTextSummary({
        summary: json.summary,
        perRole: json.perRole,
        perComposition: {},
        driftDistribution: json.summary.driftDistribution,
      });
      console.log(summary);
      console.log(`\nResults written to: ${jsonPath}`);
      console.log(`Total time: ${(elapsed / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── Parse ───────────────────────────────────────────────────────────────────

program.parse();
