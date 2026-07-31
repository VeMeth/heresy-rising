import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackVoteTarget, seedableRNG, pickRandom } from '../src/util.js';

// ── Distribution / No-Bloc Regression ────────────────────────────────────

test('fallbackVoteTarget: across many calls with same inputs, produces varied results (not deterministic faction-blind bloc)', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const results = new Set();
  for (let i = 0; i < 200; i++) {
    const result = fallbackVoteTarget(voteOptions);
    results.add(result);
  }
  // Should see multiple different targets, not always the same one
  assert.ok(results.size > 1, `Expected > 1 distinct result, got ${results.size}`);
});

// ── Never Returns 'skip' When Legal Targets Exist ──────────────────────

test('fallbackVoteTarget: never returns skip when non-skip targets are available', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  for (let i = 0; i < 100; i++) {
    const result = fallbackVoteTarget(voteOptions);
    assert.notEqual(result, 'skip', `Got skip when legal targets existed (iteration ${i})`);
  }
});

// ── Returns 'skip' When No Legal Targets Exist ───────────────────────

test('fallbackVoteTarget: returns skip when only skip is available', () => {
  const voteOptions = ['skip'];
  const result = fallbackVoteTarget(voteOptions);
  assert.equal(result, 'skip');
});

test('fallbackVoteTarget: returns skip when voteOptions is empty', () => {
  const result = fallbackVoteTarget([]);
  assert.equal(result, 'skip');
});

test('fallbackVoteTarget: returns skip when voteOptions is null', () => {
  const result = fallbackVoteTarget(null);
  assert.equal(result, 'skip');
});

// ── Only Returns Values from Legal (Non-skip) Targets ──────────────────

test('fallbackVoteTarget: result is always a member of the non-skip target set', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const legalTargets = voteOptions.filter(t => t !== 'skip');
  for (let i = 0; i < 100; i++) {
    const result = fallbackVoteTarget(voteOptions);
    assert.ok(legalTargets.includes(result), `Got ${result} which is not in legal targets`);
  }
});

// ── atRiskTargets Weighting ──────────────────────────────────────────

test('fallbackVoteTarget: when atRiskTargets has legal members, always picks from suspects only', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const atRiskTargets = ['p3'];
  // With a single-entry atRiskTargets that exists in voteOptions,
  // every call should return that suspect only (since suspects.length > 0)
  for (let i = 0; i < 50; i++) {
    const result = fallbackVoteTarget(voteOptions, atRiskTargets);
    assert.equal(result, 'p3', `Expected p3, got ${result} (iteration ${i})`);
  }
});

test('fallbackVoteTarget: when atRiskTargets has multiple legal members, picks from within them', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const atRiskTargets = ['p2', 'p4'];
  const results = new Set();
  for (let i = 0; i < 100; i++) {
    const result = fallbackVoteTarget(voteOptions, atRiskTargets);
    assert.ok(atRiskTargets.includes(result), `Got ${result} which is not in suspects`);
    results.add(result);
  }
  // Should see results from within the suspect set
  assert.ok(results.size > 0);
});

test('fallbackVoteTarget: when atRiskTargets has no legal members, falls back to all targets', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const atRiskTargets = ['p99', 'p100']; // none exist in voteOptions
  const legalTargets = voteOptions.filter(t => t !== 'skip');
  for (let i = 0; i < 50; i++) {
    const result = fallbackVoteTarget(voteOptions, atRiskTargets);
    assert.ok(legalTargets.includes(result), `Got ${result} which is not a legal target`);
  }
});

test('fallbackVoteTarget: empty atRiskTargets falls back to all non-skip targets', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const legalTargets = voteOptions.filter(t => t !== 'skip');
  for (let i = 0; i < 50; i++) {
    const result = fallbackVoteTarget(voteOptions, []);
    assert.ok(legalTargets.includes(result), `Got ${result} which is not a legal target`);
  }
});

// ── Deterministic Given Seeded RNG ──────────────────────────────────────

test('fallbackVoteTarget: same seed RNG produces same output across calls', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const rng1 = seedableRNG(42);
  const rng2 = seedableRNG(42);

  const result1 = fallbackVoteTarget(voteOptions, [], rng1);
  const result2 = fallbackVoteTarget(voteOptions, [], rng2);

  assert.equal(result1, result2, `Same seed should produce same result: ${result1} vs ${result2}`);
});

test('fallbackVoteTarget: different seeds produce different results over multiple calls', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const results1 = [];
  const results2 = [];

  const rng1 = seedableRNG(42);
  const rng2 = seedableRNG(99);

  for (let i = 0; i < 10; i++) {
    results1.push(fallbackVoteTarget(voteOptions, [], rng1));
    results2.push(fallbackVoteTarget(voteOptions, [], rng2));
  }

  // The full sequences from different seeds should differ
  // (not guaranteed to differ on every element, but the arrays themselves should differ)
  assert.notDeepEqual(results1, results2);
});

test('fallbackVoteTarget: fully deterministic rng (always 0) always returns first legal target', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const deterministicRng = () => 0;
  for (let i = 0; i < 10; i++) {
    const result = fallbackVoteTarget(voteOptions, [], deterministicRng);
    assert.equal(result, 'p1', `Expected p1 (first legal target at rng=0), got ${result}`);
  }
});

test('fallbackVoteTarget: fully deterministic rng (always 0.99) returns last legal target', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const deterministicRng = () => 0.99;
  for (let i = 0; i < 10; i++) {
    const result = fallbackVoteTarget(voteOptions, [], deterministicRng);
    // With rng = 0.99 and 5 targets, Math.floor(0.99 * 5) = Math.floor(4.95) = 4
    // So we get index 4, which is 'p5' (the last target)
    assert.equal(result, 'p5', `Expected p5 (last legal target at rng=0.99), got ${result}`);
  }
});

test('fallbackVoteTarget: deterministic rng works with atRiskTargets filtering', () => {
  const voteOptions = ['skip', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const atRiskTargets = ['p3', 'p4'];
  const deterministicRng = () => 0;

  // With suspects ['p3', 'p4'] and rng=0, pickRandom picks index 0 of suspects
  const result = fallbackVoteTarget(voteOptions, atRiskTargets, deterministicRng);
  assert.equal(result, 'p3', `Expected p3 (first suspect), got ${result}`);
});
