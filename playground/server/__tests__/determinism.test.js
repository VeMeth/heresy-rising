// Two sandboxes built from the same seed and fed the identical scripted
// inputs must produce structurally identical traces. gameCode is excluded
// from the comparison deliberately — it comes from generateRoomCode()'s bare
// Math.random() in heresy-server/src/utils.js (sandbox.js file header point
// 4), the one piece of cosmetic nondeterminism createSandbox() doesn't try
// to pin down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from '../sandbox.js';
import { captureResolution } from '../trace.js';
import { KILL_CHAIN_ROSTER, mkPlayers } from './helpers.mjs';

// createSandbox() (sandbox.js) mints every player code as `${sessionId}-pN`
// where sessionId is a fresh crypto.randomUUID() per sandbox — so even two
// runs seeded identically never share a literal player code, and that UUID
// shows up all over a trace (drift map keys, actorCode/targetCode fields,
// message recipientCode, etc). Canonicalize every occurrence down to just
// "pN" before comparing, so the comparison is actually about the trace's
// STRUCTURE and values, not incidentally about two random UUIDs never
// matching each other.
const PLAYER_CODE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-p(\d+)/g;

/** Normalize a trace for cross-sandbox comparison: strip the fields that are
 * allowed/expected to differ (gameCode is cosmetic-random per sandbox.js's
 * own file header; durationMs is wall-clock timing) and canonicalize every
 * embedded player code. */
function canonicalize(trace) {
  const { gameCode, durationMs, ...rest } = trace;
  const json = JSON.stringify(rest).replace(PLAYER_CODE_RE, (_, seat) => `p${seat}`);
  return JSON.parse(json);
}

function buildAndResolve(seed) {
  const players = mkPlayers(KILL_CHAIN_ROSTER.length);
  const sandbox = createSandbox({ players, roster: KILL_CHAIN_ROSTER, seed, options: { maxDrift: 20 } });
  const [psyker, chir, arb, sab, murd, c1, c2, c3] = sandbox.listPlayerCodes().map(p => p.playerCode);
  sandbox.forcePhase('night', 1, null);
  sandbox.manager.submitAction(sandbox.code, sab, { targetCode: c1 });
  sandbox.manager.submitAction(sandbox.code, psyker, { targetCode: c1 });
  sandbox.manager.submitAction(sandbox.code, chir, { targetCode: c2 });
  const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
  return { sandbox, trace };
}

test('determinism: identical seed + identical scripted inputs -> structurally identical traces', () => {
  const a = buildAndResolve(4242);
  const b = buildAndResolve(4242);
  try {
    assert.notEqual(a.sandbox.code, b.sandbox.code, 'precondition: room codes are cosmetically random, i.e. actually different here');
    assert.deepStrictEqual(canonicalize(a.trace), canonicalize(b.trace), 'traces match field-for-field once the cosmetic room code is excluded');
  } finally {
    a.sandbox.close();
    b.sandbox.close();
  }
});

test('determinism: a different seed produces a different trace', () => {
  const a = buildAndResolve(1);
  const b = buildAndResolve(2);
  try {
    assert.notDeepStrictEqual(canonicalize(a.trace), canonicalize(b.trace), 'sanity check: this comparison is actually sensitive to RNG-driven differences, not vacuously equal');
  } finally {
    a.sandbox.close();
    b.sandbox.close();
  }
});
