import test from 'node:test';
import assert from 'node:assert/strict';
import { runSingleGame, runBatch, runBatchParallel, resolveGameSetup } from '../src/runner.js';

// ── resolveGameSetup ─────────────────────────────────────────────────────

test('resolveGameSetup: no composition defaults playerCount to 8', () => {
  assert.deepEqual(resolveGameSetup({}), { playerCount: 8, composition: undefined });
});

test('resolveGameSetup: no composition honors an explicit playerCount', () => {
  assert.deepEqual(resolveGameSetup({ playerCount: 5 }), { playerCount: 5, composition: undefined });
});

test('resolveGameSetup: custom composition derives playerCount from roster.length', () => {
  const composition = { source: 'custom', roster: ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'] };
  const result = resolveGameSetup({ composition });
  assert.equal(result.playerCount, 5);
  assert.equal(result.composition, composition);
});

test('resolveGameSetup: preset composition derives playerCount from presetId digits', () => {
  const composition = { source: 'preset', presetId: '9p' };
  const result = resolveGameSetup({ composition });
  assert.equal(result.playerCount, 9);
});

test('resolveGameSetup: throws when explicit playerCount conflicts with composition', () => {
  const composition = { source: 'custom', roster: ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'] };
  assert.throws(() => resolveGameSetup({ playerCount: 8, composition }), /conflicts/);
});

test('resolveGameSetup: throws on empty custom roster', () => {
  assert.throws(() => resolveGameSetup({ composition: { source: 'custom', roster: [] } }), /non-empty array/);
});

test('resolveGameSetup: throws on unparseable presetId', () => {
  assert.throws(() => resolveGameSetup({ composition: { source: 'preset', presetId: 'bogus' } }), /must start with a number/);
});

test('resolveGameSetup: throws on unknown composition source', () => {
  assert.throws(() => resolveGameSetup({ composition: { source: 'weird' } }), /unknown source/);
});

// ── composition actually reaches the engine ─────────────────────────────

test('runSingleGame: custom composition roster is exactly what the engine assigns', () => {
  const roster = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const result = runSingleGame({
    composition: { source: 'custom', roster },
    seed: 42,
    maxRounds: 1, // don't care about the outcome, just the role assignment
  });
  const assignedRoles = result.players.map(p => p.roleId).sort();
  assert.deepEqual(assignedRoles, [...roster].sort());
});

test('runSingleGame: preset composition matches the current data/composition.json table for that count', () => {
  const result = runSingleGame({
    composition: { source: 'preset', presetId: '6p' },
    seed: 7,
    maxRounds: 1,
  });
  assert.equal(result.players.length, 6);
  const assignedRoles = result.players.map(p => p.roleId).sort();
  // 6p preset (data/composition.json): murderer, heretic-priest, priest,
  // interrogator, chirurgeon, novice-psychic
  assert.deepEqual(assignedRoles, ['chirurgeon', 'heretic-priest', 'interrogator', 'murderer', 'novice-psychic', 'priest']);
});

test('runSingleGame: no composition still uses the engine default preset (unchanged CLI behavior)', () => {
  const result = runSingleGame({ playerCount: 5, seed: 1, maxRounds: 1 });
  assert.equal(result.players.length, 5);
});

// ── zero-games regression: a 100%-failing batch must never look like a
// fake "200 OK, 0 games" success — see heresy-sim/sim-results/*.json for
// the historical symptom this guards against. playerCount: 3 is below the
// engine's 5-12 floor, so manager.start() throws for every single game,
// deterministically reproducing "all games fail". ──────────────────────

test('runBatch: throws (not silently returns gameCount 0) when every game fails', () => {
  assert.throws(
    () => runBatch({ games: 5, playerCount: 3, maxRounds: 1 }),
    /All 5 game\(s\) failed.*Games require 5–12 players/s
  );
});

test('runBatchParallel: throws (not silently returns gameCount 0) when every game fails', async () => {
  await assert.rejects(
    () => runBatchParallel({ games: 8, playerCount: 3, maxRounds: 1, workers: 2 }),
    /All 8 game\(s\) failed.*Games require 5–12 players/s
  );
});

test('runBatch: a healthy batch still returns real games (regression guard against over-fixing)', () => {
  const result = runBatch({ games: 3, playerCount: 5, seed: 100, maxRounds: 10 });
  assert.equal(result.meta.gameCount, 3);
  assert.equal(result.results.length, 3);
});

test('runBatchParallel: a healthy batch still returns real games (regression guard against over-fixing)', async () => {
  const result = await runBatchParallel({ games: 8, playerCount: 5, seed: 200, maxRounds: 10, workers: 2 });
  assert.equal(result.meta.gameCount, 8);
  assert.equal(result.meta.workers, 2);
  assert.equal(result.results.length, 8);
});

test('runBatch/runBatchParallel: composition flows through the batch runners and worker threads', async () => {
  const composition = { source: 'custom', roster: ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'] };
  const seq = runBatch({ games: 2, composition, seed: 1, maxRounds: 1 });
  assert.equal(seq.meta.playerCount, 5);
  for (const g of seq.results) assert.deepEqual(g.composition.map(c => c.roleId).sort(), [...composition.roster].sort());

  const parallel = await runBatchParallel({ games: 8, composition, seed: 1, maxRounds: 1, workers: 2 });
  assert.equal(parallel.meta.playerCount, 5);
  for (const g of parallel.results) assert.deepEqual(g.composition.map(c => c.roleId).sort(), [...composition.roster].sort());
});
