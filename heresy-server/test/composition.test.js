import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';
import { validateComposition } from '../src/validators/composition.js';

function fixture(count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-comp-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({
    databasePath: path.join(dir, 'game.db'),
    now: () => now,
    random: () => 0.9
  });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) {
    manager.join({ code, playerCode: `p${i}`, name: `P${i}` });
    manager.ready(code, `p${i}`, true);
  }
  return {
    manager,
    code,
    close() {
      manager.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const PRESETS = {
  5:  ['murderer','priest','interrogator','chirurgeon','imperial-citizen'],
  6:  ['murderer','heretic-priest','priest','interrogator','chirurgeon','novice-psychic'],
  7:  ['murderer','heretic-priest','priest','interrogator','chirurgeon','novice-psychic','imperial-citizen'],
  8:  ['murderer','heretic-priest','saboteur','priest','interrogator','chirurgeon','arbitrator','imperial-citizen'],
  9:  ['murderer','heretic-priest','saboteur','priest','interrogator','chirurgeon','novice-psychic','arbitrator','imperial-citizen'],
  10: ['murderer','heretic-priest','saboteur','recruiter','priest','interrogator','chirurgeon','novice-psychic','arbitrator','imperial-citizen'],
  11: ['murderer','heretic-priest','conspirator','saboteur','recruiter','priest','interrogator','chirurgeon','novice-psychic','arbitrator','imperial-citizen'],
  12: ['murderer','heretic-priest','conspirator','saboteur','recruiter','priest','interrogator','chirurgeon','novice-psychic','arbitrator','imperial-citizen','imperial-citizen']
};

function getAssignedRoles(manager, code) {
  return manager.players(code).map(p => p.role_id).sort();
}

// ── Preset path: 5p through 12p ──

for (let n = 5; n <= 12; n++) {
  test(`preset path: start() with omitted composition uses ${n}p preset`, () => {
    const f = fixture(n);
    try {
      const state = f.manager.start(f.code, 'p0');
      assert.equal(state.phase, 'role-reveal');
      assert.equal(state.players.length, n);
      const assigned = getAssignedRoles(f.manager, f.code);
      const expected = PRESETS[n].slice().sort();
      assert.deepEqual(assigned, expected);
    } finally {
      f.close();
    }
  });
}

// ── Custom happy path: 5p, 8p, 11p ──

test('custom happy path: valid 5p custom roster accepted', () => {
  const f = fixture(5);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: PRESETS[5],
        confirmedWarnings: []
      }
    });
    assert.equal(state.phase, 'role-reveal');
    assert.equal(state.players.length, 5);
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.deepEqual(assigned, PRESETS[5].slice().sort());
  } finally {
    f.close();
  }
});

test('custom happy path: valid 8p custom roster accepted', () => {
  const f = fixture(8);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: PRESETS[8],
        confirmedWarnings: []
      }
    });
    assert.equal(state.phase, 'role-reveal');
    assert.equal(state.players.length, 8);
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.deepEqual(assigned, PRESETS[8].slice().sort());
  } finally {
    f.close();
  }
});

test('custom happy path: valid 11p custom roster accepted', () => {
  const f = fixture(11);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: PRESETS[11],
        confirmedWarnings: []
      }
    });
    assert.equal(state.phase, 'role-reveal');
    assert.equal(state.players.length, 11);
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.deepEqual(assigned, PRESETS[11].slice().sort());
  } finally {
    f.close();
  }
});

// ── Hard-fail: H1–H5 ──

test('hard-fail H1: roster length mismatch rejects start()', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: PRESETS[6],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, 'lobby');
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H1'));
  } finally {
    f.close();
  }
});

test('hard-fail H2: duplicate non-citizen role rejects start()', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['interrogator', 'interrogator', 'priest', 'chirurgeon', 'imperial-citizen'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H2'));
  } finally {
    f.close();
  }
});

test('hard-fail H3: unknown role ID rejects start()', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['murderer', 'priest', 'interrogator', 'chirurgeon', 'nonexistent-role'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H3'));
  } finally {
    f.close();
  }
});

test('hard-fail H4: heretic count exceeding loyalist count rejects start()', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['murderer', 'heretic-priest', 'saboteur', 'priest', 'interrogator'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H4'));
  } finally {
    f.close();
  }
});

test('hard-fail H5: no heretics in roster rejects start()', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['priest', 'interrogator', 'chirurgeon', 'novice-psychic', 'arbitrator'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H5'));
  } finally {
    f.close();
  }
});

// ── Soft-fail: S1–S5 (via validator directly for S1, via start() for S2–S5) ──

test('soft-fail S1: priest in roster below 5p rejected without acknowledgement', () => {
  const roles = new Map();
  const hardRules = {
    priest_min_player_count: 5,
    heretic_priest_min_player_count: 6,
    recruiter_min_player_count: 8,
    conspirator_min_player_count: 11
  };
  const rosterIds = ['priest','interrogator','murderer','chirurgeon'];
  for (const id of rosterIds) roles.set(id, { id, faction: id === 'murderer' ? 'heretic' : 'loyalist' });
  const result = validateComposition({
    roster: rosterIds,
    playerCount: 4,
    confirmedWarnings: [],
    validRoles: roles,
    hardRules,
    source: 'custom'
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.kind === 'soft_unacknowledged' && e.rule === 'S1'));
  assert.ok(result.warnings.some(w => w.rule === 'S1'));
});

test('soft-fail S1: priest in roster below 5p accepted with acknowledgement', () => {
  const roles = new Map();
  const hardRules = {
    priest_min_player_count: 5,
    heretic_priest_min_player_count: 6,
    recruiter_min_player_count: 8,
    conspirator_min_player_count: 11
  };
  const rosterIds = ['priest','interrogator','murderer','chirurgeon'];
  for (const id of rosterIds) roles.set(id, { id, faction: id === 'murderer' ? 'heretic' : 'loyalist' });
  const result = validateComposition({
    roster: rosterIds,
    playerCount: 4,
    confirmedWarnings: ['S1'],
    validRoles: roles,
    hardRules,
    source: 'custom'
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.rule === 'S1'));
  assert.ok(!result.errors.some(e => e.rule === 'S1'));
});

test('soft-fail S2: heretic-priest in 5p roster rejected without acknowledgement', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['heretic-priest', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'soft_unacknowledged' && e.rule === 'S2'));
  } finally {
    f.close();
  }
});

test('soft-fail S2: heretic-priest in 5p roster accepted with acknowledgement', () => {
  const f = fixture(5);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['heretic-priest', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'],
        confirmedWarnings: ['S2']
      }
    });
    assert.equal(state.phase, 'role-reveal');
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.ok(assigned.includes('heretic-priest'));
  } finally {
    f.close();
  }
});

test('soft-fail S3: recruiter in 5p roster rejected without acknowledgement', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['recruiter', 'murderer', 'priest', 'interrogator', 'chirurgeon'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'soft_unacknowledged' && e.rule === 'S3'));
  } finally {
    f.close();
  }
});

test('soft-fail S3: recruiter in 5p roster accepted with acknowledgement', () => {
  const f = fixture(5);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['recruiter', 'murderer', 'priest', 'interrogator', 'chirurgeon'],
        confirmedWarnings: ['S3']
      }
    });
    assert.equal(state.phase, 'role-reveal');
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.ok(assigned.includes('recruiter'));
  } finally {
    f.close();
  }
});

test('soft-fail S4: conspirator in 5p roster rejected without acknowledgement', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['conspirator', 'murderer', 'priest', 'interrogator', 'chirurgeon'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'soft_unacknowledged' && e.rule === 'S4'));
  } finally {
    f.close();
  }
});

test('soft-fail S4: conspirator in 5p roster accepted with acknowledgement', () => {
  const f = fixture(5);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['conspirator', 'murderer', 'priest', 'interrogator', 'chirurgeon'],
        confirmedWarnings: ['S4']
      }
    });
    assert.equal(state.phase, 'role-reveal');
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.ok(assigned.includes('conspirator'));
  } finally {
    f.close();
  }
});

test('soft-fail S5: heretic-priest without priest/chirurgeon rejected without acknowledgement', () => {
  const f = fixture(6);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['heretic-priest', 'murderer', 'interrogator', 'novice-psychic', 'arbitrator', 'imperial-citizen'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'soft_unacknowledged' && e.rule === 'S5'));
  } finally {
    f.close();
  }
});

test('soft-fail S5: heretic-priest without priest/chirurgeon accepted with acknowledgement', () => {
  const f = fixture(6);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['heretic-priest', 'murderer', 'interrogator', 'novice-psychic', 'arbitrator', 'imperial-citizen'],
        confirmedWarnings: ['S5']
      }
    });
    assert.equal(state.phase, 'role-reveal');
    const assigned = getAssignedRoles(f.manager, f.code);
    assert.ok(assigned.includes('heretic-priest'));
    assert.ok(!assigned.includes('priest'));
    assert.ok(!assigned.includes('chirurgeon'));
  } finally {
    f.close();
  }
});

// ── Preset path skips soft rules ──

test('preset path skips soft rules: 5p preset accepted without soft-rule checks', () => {
  const f = fixture(5);
  try {
    const state = f.manager.start(f.code, 'p0', {
      composition: { source: 'preset', presetId: '5p' }
    });
    assert.equal(state.phase, 'role-reveal');
  } finally {
    f.close();
  }
});

// ── Privacy regression ──

test('privacy regression: lobby state has compositionLabel but never composition', () => {
  const f = fixture(8);
  try {
    const lobbyState = f.manager.state(f.code, 'p0');
    assert.equal(lobbyState.phase, 'lobby');
    assert.equal('composition' in lobbyState, false, 'composition must not appear in lobby state');
    assert.equal(lobbyState.compositionLabel, '8-operative doctrine');
    const serialized = JSON.stringify(lobbyState);
    assert.ok(!serialized.includes('"composition"'), 'no "composition" key in serialized lobby state');
    assert.ok(!serialized.includes('murderer'), 'no role IDs in lobby state');
    assert.ok(!serialized.includes('interrogator'), 'no role IDs in lobby state');
    assert.ok(!serialized.includes('heretic-priest'), 'no role IDs in lobby state');

    f.manager.start(f.code, 'p0');
    const postStartState = f.manager.state(f.code, 'p0');
    assert.equal('compositionLabel' in postStartState, false, 'compositionLabel must not appear after start()');
    assert.equal('composition' in postStartState, false, 'composition must not appear after start()');
  } finally {
    f.close();
  }
});

// ── Validator error shape matches spec ──

test('validator error shape matches spec: structured errors and warnings', () => {
  const f = fixture(5);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: {
        source: 'custom',
        roster: ['interrogator', 'interrogator', 'priest', 'chirurgeon', 'imperial-citizen'],
        confirmedWarnings: []
      }
    });
    assert.equal(result.ok, false);
    assert.equal(typeof result.phase, 'string');
    assert.ok(result.composition);
    assert.equal(result.composition.source, 'custom');
    assert.ok(Array.isArray(result.errors));
    assert.ok(Array.isArray(result.warnings));
    for (const err of result.errors) {
      assert.equal(typeof err.kind, 'string');
      assert.equal(typeof err.rule, 'string');
      assert.equal(typeof err.message, 'string');
    }
  } finally {
    f.close();
  }
});

// ── presetId mismatch rejected (decision a) ──

test('preset path: presetId mismatch with player count rejected via H1', () => {
  const f = fixture(7);
  try {
    const result = f.manager.start(f.code, 'p0', {
      composition: { source: 'preset', presetId: '8p' }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind === 'hard' && e.rule === 'H1'));
  } finally {
    f.close();
  }
});
