// stations.js's ENGINE_CONTRACT pins a hash of the exact heresyGameManager.js
// line spans the trace classifier was validated against. If the engine
// changes in a way that shifts those spans, computeEngineContractHash()
// stops matching and every derived (non-observed) claim in a trace becomes
// suspect. This is the tripwire test for that pin itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../sandbox.js';
import { captureResolution } from '../trace.js';
import { ENGINE_CONTRACT, computeEngineContractHash } from '../stations.js';
import { buildKillChainSandbox } from './helpers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('computeEngineContractHash(repoRoot) matches the pinned ENGINE_CONTRACT.hash', () => {
  const computed = computeEngineContractHash(REPO_ROOT);
  assert.equal(typeof computed, 'string');
  assert.equal(computed.length, 64, 'sha256 hex digest is 64 characters');
  assert.equal(computed, ENGINE_CONTRACT.hash,
    'the engine changed in a way that shifted the pinned spans — every derived (non-observed) trace claim needs re-validating, and ENGINE_CONTRACT.hash needs re-pinning to the new text');
});

test("a Trace's integrity.contractHashMatches is a strict boolean, and true when the contract is pinned correctly", () => {
  const { sandbox, psyker, c1 } = buildKillChainSandbox(createSandbox, { seed: 301 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.manager.submitAction(sandbox.code, psyker, { targetCode: c1 });
    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });

    assert.equal(typeof trace.integrity.contractHashMatches, 'boolean', 'strict boolean, not a truthy/falsy stand-in');
    assert.equal(trace.integrity.contractHashMatches, true);
    assert.equal(trace.engineContractHash, ENGINE_CONTRACT.hash);
  } finally {
    sandbox.close();
  }
});
