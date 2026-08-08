// Golden-case coverage for the six kill outcomes documented in
// heresyGameManager.js:826-843 (KILL_PRECEDENCE, stations.js). Every case
// asserts BOTH the verdict trace.js assigns AND integrity.ok === true — a
// trace that can't verify its own story is not a trustworthy golden case,
// whatever verdict it printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from '../sandbox.js';
import { captureResolution, VERDICTS } from '../trace.js';
import { buildKillChainSandbox } from './helpers.mjs';

function killAction(actorCode, targetCode) {
  return { targetCode };
}

test('kill-chain: clean kill lands', () => {
  const { sandbox, psyker, c1 } = buildKillChainSandbox(createSandbox, { seed: 101 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.manager.submitAction(sandbox.code, psyker, killAction(psyker, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === psyker);
    assert.equal(kill.verdict, VERDICTS.LANDED);
    assert.equal(kill.effectiveVictim, c1);

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 0, 'target died');
    assert.equal(sandbox.manager.player(sandbox.code, c1).death_cause, 'murder');
    assert.equal(sandbox.manager.player(sandbox.code, psyker).alive, 1, 'actor survives');
  } finally {
    sandbox.close();
  }
});

test('kill-chain: trap on the ACTOR blocks the kill', () => {
  const { sandbox, psyker, sab, c1 } = buildKillChainSandbox(createSandbox, { seed: 102 });
  try {
    sandbox.forcePhase('night', 1, null);
    // Saboteur traps the KILLER, not the victim.
    sandbox.manager.submitAction(sandbox.code, sab, { targetCode: psyker });
    sandbox.manager.submitAction(sandbox.code, psyker, killAction(psyker, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === psyker);
    assert.equal(kill.verdict, VERDICTS.BLOCKED_BY_TRAP);
    assert.equal(kill.effectiveVictim, null);

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 1, 'target survives — the kill never landed');
    assert.equal(sandbox.manager.player(sandbox.code, psyker).alive, 1, 'trapped actor survives too, just taxed');
  } finally {
    sandbox.close();
  }
});

test('kill-chain: trap on the TARGET taxes the actor but the kill still LANDS', () => {
  // heresyGameManager.js:829 — a target-trap charges TRAP_DRIFT to the actor
  // and falls through; only an actor-trap causes the `continue` that blocks.
  const { sandbox, psyker, sab, c1 } = buildKillChainSandbox(createSandbox, { seed: 103 });
  try {
    sandbox.forcePhase('night', 1, null);
    // Saboteur traps the VICTIM this time.
    sandbox.manager.submitAction(sandbox.code, sab, { targetCode: c1 });
    sandbox.manager.submitAction(sandbox.code, psyker, killAction(psyker, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === psyker);
    assert.equal(kill.verdict, VERDICTS.LANDED, 'a trap on the TARGET does not block the kill');
    assert.equal(kill.effectiveVictim, c1);
    assert.equal(kill.trapScope, 'target');

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 0, 'target still died');
    assert.equal(sandbox.manager.player(sandbox.code, c1).death_cause, 'murder');
  } finally {
    sandbox.close();
  }
});

test('kill-chain: bodyguard on the target redirects — the guard dies instead', () => {
  const { sandbox, psyker, arb, c1 } = buildKillChainSandbox(createSandbox, { seed: 104 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.manager.submitAction(sandbox.code, arb, { targetCode: c1 }); // arbitrator guards c1
    sandbox.manager.submitAction(sandbox.code, psyker, killAction(psyker, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === psyker);
    assert.equal(kill.verdict, VERDICTS.REDIRECTED_TO_BODYGUARD);
    assert.equal(kill.effectiveVictim, arb, 'the bodyguard is the one who actually died');

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 1, 'the named target survives');
    assert.equal(sandbox.manager.player(sandbox.code, arb).alive, 0, 'the guard dies');
    assert.equal(sandbox.manager.player(sandbox.code, arb).death_cause, 'murder');

    const death = trace.deaths.find(d => d.playerCode === arb);
    assert.ok(death, 'the guard shows up in trace.deaths');
    assert.equal(death.attributedTo, psyker);
  } finally {
    sandbox.close();
  }
});

test('kill-chain: protect on the target absorbs the kill — nobody dies', () => {
  const { sandbox, psyker, chir, c1 } = buildKillChainSandbox(createSandbox, { seed: 105 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.manager.submitAction(sandbox.code, chir, { targetCode: c1 }); // chirurgeon protects c1
    sandbox.manager.submitAction(sandbox.code, psyker, killAction(psyker, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === psyker);
    assert.equal(kill.verdict, VERDICTS.ABSORBED_BY_PROTECT);
    assert.equal(kill.effectiveVictim, null);

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 1, 'protected target survives');
    assert.equal(sandbox.manager.player(sandbox.code, psyker).alive, 1);
    assert.equal(trace.deaths.length, 0, 'nobody died this round');
  } finally {
    sandbox.close();
  }
});

test('kill-chain: murderer whose drift + killWeight > maxDrift is gated', () => {
  // Only the 'murderer' role is drift-gated (heresyGameManager.js: "killer.role_id
  // ==='murderer'") — sanctioned-psyker and any other kill-capable role pay
  // their self-cost unconditionally. driftWeight for murderer is 15
  // (game_data/roles-40k.json); maxDrift here is 20, so starting drift needs
  // to push drift+15 past 20 for the gate to trip.
  const { sandbox, murd, c1 } = buildKillChainSandbox(createSandbox, { seed: 106 });
  try {
    sandbox.updatePlayer(murd, { drift: 10 }); // 10 + 15 = 25 > 20
    sandbox.forcePhase('night', 1, null);
    sandbox.manager.submitAction(sandbox.code, murd, killAction(murd, c1));

    const trace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.equal(trace.integrity.ok, true, 'trace integrity holds');

    const kill = trace.actions.find(a => a.actorCode === murd);
    assert.equal(kill.verdict, VERDICTS.GATED_BY_DRIFT);
    assert.equal(kill.effectiveVictim, null);

    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 1, 'gated kill never lands');
    assert.equal(sandbox.manager.player(sandbox.code, murd).drift, 10, 'gated murderer pays NO self-cost');
    assert.equal(trace.deaths.length, 0);
  } finally {
    sandbox.close();
  }
});
