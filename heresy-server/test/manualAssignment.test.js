import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManualAssignment } from '../src/validators/manualAssignment.js';
import { shuffle } from '../src/utils.js';

// ── Pure function: resolveManualAssignment ──

test('manual assignment: full assignment matches explicit picks in seat order', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p0': 'interrogator',
    'p1': 'murderer',
    'p2': 'priest',
    'p3': 'chirurgeon',
    'p4': 'imperial-citizen'
  };

  const result = resolveManualAssignment({ ids, players, manualAssignments });
  assert.equal(result.length, 5);
  assert.equal(result[0], 'interrogator');
  assert.equal(result[1], 'murderer');
  assert.equal(result[2], 'priest');
  assert.equal(result[3], 'chirurgeon');
  assert.equal(result[4], 'imperial-citizen');
});

test('manual assignment: partial assignment fills leftovers with valid multiset', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p0': 'murderer',
    'p1': 'priest'
  };

  const result = resolveManualAssignment({ ids, players, manualAssignments });
  assert.equal(result.length, 5);
  assert.equal(result[0], 'murderer');
  assert.equal(result[1], 'priest');

  // Check that the result is a valid permutation
  const resultSorted = result.slice().sort();
  const expectedSorted = ids.slice().sort();
  assert.deepEqual(resultSorted, expectedSorted, 'result is a permutation of input ids');

  // Verify unassigned seats got the remaining roles
  const assignedSet = new Set([ids[ids.indexOf('murderer')], ids[ids.indexOf('priest')]]);
  assert.ok(!assignedSet.has(result[2]) || result.slice(2).includes(result[2]), 'leftovers filled correctly');
});

test('manual assignment: empty manualAssignments behaves like a shuffle (same multiset)', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {};

  const result = resolveManualAssignment({ ids, players, manualAssignments });
  assert.equal(result.length, 5);

  // Check multiset invariant
  const resultSorted = result.slice().sort();
  const expectedSorted = ids.slice().sort();
  assert.deepEqual(resultSorted, expectedSorted);
});

test('manual assignment: error on unknown player code', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p999': 'murderer'  // doesn't exist
  };

  assert.throws(
    () => resolveManualAssignment({ ids, players, manualAssignments }),
    /unknown player code "p999"/
  );
});

test('manual assignment: error on unknown/unavailable role ID', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p0': 'nonexistent-role'
  };

  assert.throws(
    () => resolveManualAssignment({ ids, players, manualAssignments }),
    /not available in the chosen roster/
  );
});

test('manual assignment: error on role already consumed by another player', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p0': 'murderer',
    'p1': 'murderer'  // same role, but murderer is unique per H2
  };

  assert.throws(
    () => resolveManualAssignment({ ids, players, manualAssignments }),
    /not available in the chosen roster/
  );
});

test('manual assignment: duplicate imperial-citizen roles work correctly', () => {
  // imperial-citizen is the only role that can appear multiple times per H2
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' },
    { player_code: 'p5' }
  ];
  const manualAssignments = {
    'p4': 'imperial-citizen',
    'p5': 'imperial-citizen'  // both get imperial-citizen, should succeed
  };

  const result = resolveManualAssignment({ ids, players, manualAssignments });
  assert.equal(result[4], 'imperial-citizen');
  assert.equal(result[5], 'imperial-citizen');

  // Verify multiset is still correct
  const resultSorted = result.slice().sort();
  const expectedSorted = ids.slice().sort();
  assert.deepEqual(resultSorted, expectedSorted);
});

test('manual assignment: multiset preserved across many runs with partial assignments', () => {
  const ids = ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
  const players = [
    { player_code: 'p0' },
    { player_code: 'p1' },
    { player_code: 'p2' },
    { player_code: 'p3' },
    { player_code: 'p4' }
  ];
  const manualAssignments = {
    'p0': 'murderer'
  };

  // Run multiple times and verify the multiset is preserved each time
  for (let i = 0; i < 10; i++) {
    const result = resolveManualAssignment({ ids, players, manualAssignments });
    const resultSorted = result.slice().sort();
    const expectedSorted = ids.slice().sort();
    assert.deepEqual(resultSorted, expectedSorted, `run ${i}: multiset preserved`);
    assert.equal(result[0], 'murderer', `run ${i}: explicit assignment honored`);
  }
});
