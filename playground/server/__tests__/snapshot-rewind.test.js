// Snapshot/rewind must restore the board EXACTLY, including the sqlite
// autoincrement sequence (sandbox.js's whole rationale for using
// manager.db.serialize()/a fresh Database(buffer) instead of a hand-rolled
// JSON dump: a JSON dump could restore row CONTENTS but not sqlite_sequence,
// so a caller could still tell rewind() happened by watching the next
// inserted id keep climbing instead of resuming where it left off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from '../sandbox.js';
import { captureResolution } from '../trace.js';
import { buildKillChainSandbox } from './helpers.mjs';

test('snapshot/rewind restores mutated fields exactly', () => {
  const { sandbox, psyker, c1 } = buildKillChainSandbox(createSandbox, { seed: 201 });
  try {
    sandbox.forcePhase('night', 1, null);

    const before = sandbox.manager.player(sandbox.code, psyker);
    assert.equal(before.alive, 1);
    assert.equal(before.drift, 0);
    assert.equal(before.cripple_tier, 0);
    assert.equal(before.tortured_before, 0);

    sandbox.snapshot('pre-mutation');

    // Mutate drift, cripple tier, alive, and a raw flag.
    sandbox.updatePlayer(psyker, { drift: 12, alive: 0, crippleTier: 2 });
    sandbox.setPlayerRaw(psyker, { torturedBefore: true });

    const mutated = sandbox.manager.player(sandbox.code, psyker);
    assert.equal(mutated.alive, 0);
    assert.equal(mutated.drift, 12);
    assert.equal(mutated.cripple_tier, 2);
    assert.equal(mutated.tortured_before, 1);

    sandbox.rewind();

    const restored = sandbox.manager.player(sandbox.code, psyker);
    assert.equal(restored.alive, before.alive, 'alive restored');
    assert.equal(restored.drift, before.drift, 'drift restored');
    assert.equal(restored.cripple_tier, before.cripple_tier, 'cripple tier restored');
    assert.equal(restored.tortured_before, before.tortured_before, 'raw flag restored');
    // Every field, not just the ones we touched — a real DB restore, not a
    // partial patch-back of the fields the test happened to think of.
    for (const key of Object.keys(before)) {
      assert.equal(restored[key], before[key], `column ${key} restored`);
    }
  } finally {
    sandbox.close();
  }
});

test('snapshot/rewind restores the sqlite autoincrement sequence, not just row content', () => {
  const { sandbox, psyker, c1 } = buildKillChainSandbox(createSandbox, { seed: 202 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.snapshot('pre-resolve');

    // Generate hr_messages/hr_events rows (both AUTOINCREMENT) via a real
    // resolution, so there's an autoincrement sequence to prove gets rewound.
    sandbox.manager.submitAction(sandbox.code, psyker, { targetCode: c1 });
    const firstTrace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    assert.ok(firstTrace.diff.newMessageIds.length > 0, 'precondition: the first resolve actually wrote messages');
    const firstRunFirstMessageId = firstTrace.diff.newMessageIds[0];

    sandbox.rewind();

    // Board is back to pre-resolve: night 1, target still alive, no action
    // submitted (the kill action row itself is gone too — hr_actions is a
    // plain table with no autoincrement, but its content still needs to
    // have rewound along with everything else).
    const game = sandbox.manager.game(sandbox.code);
    assert.equal(game.phase, 'night');
    assert.equal(game.round, 1);
    assert.equal(sandbox.manager.player(sandbox.code, c1).alive, 1, 'target is alive again — the kill never happened as far as the DB is concerned');
    const actionsAfterRewind = sandbox.manager.db
      .prepare('SELECT * FROM hr_actions WHERE game_code=? AND round=1').all(sandbox.code);
    assert.equal(actionsAfterRewind.length, 0, 'the submitted action row is gone too');

    // Re-run the exact same sequence of moves.
    sandbox.manager.submitAction(sandbox.code, psyker, { targetCode: c1 });
    const secondTrace = captureResolution(sandbox.manager, sandbox.code, { rngRecorder: sandbox.rng });
    const secondRunFirstMessageId = secondTrace.diff.newMessageIds[0];

    // If rewind() only restored row CONTENT (e.g. a hand-rolled JSON dump)
    // but left sqlite_sequence alone, this second run's first new message id
    // would keep climbing from wherever the first run left off. Restoring
    // the real serialized DB file resets it, so the id sequence repeats
    // exactly.
    assert.equal(secondRunFirstMessageId, firstRunFirstMessageId, 'the autoincrement sequence itself was rewound, not just row content');
  } finally {
    sandbox.close();
  }
});

test('rewind() pops snapshots in LIFO order and throws once the stack is empty', () => {
  const { sandbox } = buildKillChainSandbox(createSandbox, { seed: 203 });
  try {
    sandbox.forcePhase('night', 1, null);
    sandbox.snapshot('one');
    sandbox.snapshot('two');
    assert.equal(sandbox.history().length, 2);

    const poppedTwo = sandbox.rewind();
    assert.equal(poppedTwo.label, 'two');
    assert.equal(sandbox.history().length, 1);

    const poppedOne = sandbox.rewind();
    assert.equal(poppedOne.label, 'one');
    assert.equal(sandbox.history().length, 0);

    assert.throws(() => sandbox.rewind(), /No snapshot to rewind to/);
  } finally {
    sandbox.close();
  }
});
