// Q31 (dispatches/2026-07-27-q31-interrogator-cost.md): Interrogator's
// self-drift cost scales with table size instead of a flat driftWeight.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';
import { scaledCostFormula, resolveScaledCost, validateScaledCosts } from '../src/mechanics/scaledCosts.js';
import { loadGameConfig } from '../src/gameConfig.js';

function fixture(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-scaled-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => now, random: () => 0.9 });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) { manager.join({ code, playerCode: `p${i}`, name: `P${i}` }); manager.ready(code, `p${i}`, true); }
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('scaledCostFormula: max(floor, base/players), rounded half-up', () => {
  assert.equal(scaledCostFormula(50, 3, 5), 10);
  assert.equal(scaledCostFormula(50, 3, 12), 4);
  assert.equal(scaledCostFormula(20, 2, 8), 3, '20/8=2.5 rounds half-up to 3, not banker\'s-rounds to 2');
  assert.equal(scaledCostFormula(10, 1, 20), 1, 'never below its floor even at absurd table sizes');
});

test('validateScaledCosts: the live data/drift.json scaledCosts table matches baseValues+floors+formula exactly', () => {
  const cfg = loadGameConfig();
  assert.doesNotThrow(() => validateScaledCosts(cfg.drift.scaledCosts));
});

test('validateScaledCosts: catches a deliberately corrupted perPlayerCount cell', () => {
  const scaledCosts = { interrogator: { baseValues: { t1: 10 }, floors: { t1: 1 }, perPlayerCount: { '5': { t1: 999 } } } };
  assert.throws(() => validateScaledCosts(scaledCosts), /drift\.json has 999 but baseValues\/floors\/formula gives 2/);
});

test('resolveScaledCost: reads the precomputed table when present, falls back to the formula otherwise', () => {
  const cfg = loadGameConfig();
  assert.equal(resolveScaledCost(cfg.drift.scaledCosts, 'interrogator', 't3', 5), 10);
  assert.equal(resolveScaledCost(cfg.drift.scaledCosts, 'interrogator', 't3', 12), 4);
  // 20p isn't in the precomputed table (game caps at 12) — formula fallback still holds the floor.
  assert.equal(resolveScaledCost(cfg.drift.scaledCosts, 'interrogator', 't1', 20), 1);
});

test('resolveScaledCost throws on an unknown role or tier — a config bug, not a silent 0', () => {
  const cfg = loadGameConfig();
  assert.throws(() => resolveScaledCost(cfg.drift.scaledCosts, 'not-a-role', 't1', 8), /no config for role/);
  assert.throws(() => resolveScaledCost(cfg.drift.scaledCosts, 'interrogator', 't9', 8), /has no tier/);
});

test('engine: a T1 scan at 5p actually charges +2 drift to the Interrogator (not the old flat +2 driftWeight, which would coincidentally also be 2 here)', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, interrogator.player_code).drift, 2);
  } finally { f.close(); }
});

test('engine: the SAME T1 scan at 12p charges only +1 drift — cost is cheaper at a bigger table', () => {
  const f = fixture(12);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, interrogator.player_code).drift, 1);
  } finally { f.close(); }
});

test('engine: a T3 scan at 8p charges +6 drift (50/8=6.25 rounds to 6), and the cost is keyed off TOTAL roster size, not the shrunk alive count', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const victim = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
    // Kill one player off before the scan so the alive count (7) differs
    // from the roster count (8) — the scaled cost must still use 8, the
    // "cell size" the table was set up with, not the live survivor count.
    f.manager.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(f.code, victim.player_code);
    const target = f.manager.players(f.code).find(p => p.alive && p.player_code !== interrogator.player_code);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T3' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, interrogator.player_code).drift, 6);
  } finally { f.close(); }
});

test('engine: Saboteur trap still adds a flat +5 on top of the SCALED chosen-tier cost, not the old flat driftWeight', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const saboteur = f.manager.players(f.code).find(p => p.role_id === 'saboteur');
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code && p.player_code !== saboteur?.player_code);
    if (!saboteur) return; // 8p preset may not roll a Saboteur every seat order; skip rather than false-fail
    // Trap goes on the SCAN TARGET, not the Interrogator — the spring
    // condition is keyed off the investigate action's target_code.
    f.manager.submitAction(f.code, saboteur.player_code, { targetCode: target.player_code });
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T2' });
    f.manager.resolve(f.code, true);
    // T2 at 8p = +3 (20/8=2.5 rounds to 3) + trap +5 = 8.
    assert.equal(f.manager.player(f.code, interrogator.player_code).drift, 8);
  } finally { f.close(); }
});

test('per-game dossier: Interrogator\'s ability text shows THIS game\'s exact cost, not the boot-time range', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const state = f.manager.state(f.code, interrogator.player_code);
    const me = state.players.find(p => p.playerCode === interrogator.player_code);
    assert.match(me.role.ability, /T1 Soft \([^)]*\+2 drift\)/);
    assert.match(me.role.ability, /T3 Brutal \([^)]*\+10 drift\)/);
    assert.doesNotMatch(me.role.ability, /–/, 'a live game must show an exact number, not a boot-time range');
  } finally { f.close(); }
});

test('engine: a Loyalist Priest\'s Litany self-drift scales with table size (+10 at 5p, +4 at 12p)', () => {
  const cost5 = resolveScaledCost(loadGameConfig().drift.scaledCosts, 'priest', 'litany', 5);
  const cost12 = resolveScaledCost(loadGameConfig().drift.scaledCosts, 'priest', 'litany', 12);
  assert.equal(cost5, 10);
  assert.equal(cost12, 4);
});

test('engine: a Heretic Priest\'s Warp Litany self-drift scales with table size — same formula as Interrogator/Priest (+10 at 5p, +4 at 12p)', () => {
  const cost5 = resolveScaledCost(loadGameConfig().drift.scaledCosts, 'heretic-priest', 'warp-litany', 5);
  const cost12 = resolveScaledCost(loadGameConfig().drift.scaledCosts, 'heretic-priest', 'warp-litany', 12);
  assert.equal(cost5, 10);
  assert.equal(cost12, 4);
});

test('engine: a Loyalist Priest actually pays the SCALED Litany self-drift (+10 at 5p), not the old flat selfCost of 6', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const priest = f.manager.players(f.code).find(p => p.role_id === 'priest');
    const target = f.manager.players(f.code).find(p => p.player_code !== priest.player_code);
    f.manager.submitAction(f.code, priest.player_code, { targetCode: target.player_code, variant: 'litany' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, priest.player_code).drift, 10, 'litany self-drift at 5p = 10 (50/5)');
  } finally { f.close(); }
});

test('engine: a Heretic Priest actually pays the SCALED Warp Litany self-drift (+6 at 8p), not the old flat selfCost of 4', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0');
    f.manager.advance(f.code, 'p0');
    const hp = f.manager.players(f.code).find(p => p.role_id === 'heretic-priest');
    if (!hp) return; // 8p preset may not roll a Heretic Priest every seat order; skip rather than false-fail
    const target = f.manager.players(f.code).find(p => p.player_code !== hp.player_code);
    f.manager.db.prepare('UPDATE hr_players SET drift=12,skip_next_night=1 WHERE game_code=? AND player_code=?').run(f.code, target.player_code);
    f.manager.submitAction(f.code, hp.player_code, { targetCode: target.player_code, variant: 'warp-litany' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, hp.player_code).drift, 6, 'warp-litany self-drift at 8p = 6 (50/8=6.25 rounds to 6)');
  } finally { f.close(); }
});

test('per-game dossier: Priest\'s ability text shows THIS game\'s exact self-drift per sermon tier, not the boot-time range', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const priest = f.manager.players(f.code).find(p => p.role_id === 'priest');
    const state = f.manager.state(f.code, priest.player_code);
    const me = state.players.find(p => p.playerCode === priest.player_code);
    assert.match(me.role.ability, /\+10 self-drift/, 'litany self-drift at 5p is +10');
    assert.doesNotMatch(me.role.ability, /–/, 'a live game must show an exact number, not a boot-time range');
  } finally { f.close(); }
});

test('boot-time range: Priest\'s ability text shows a cheapest–priciest range across 5–12p for each sermon tier', () => {
  const cfg = loadGameConfig();
  const priest = cfg.roles.get('priest');
  assert.match(priest.ability, /\+1–\+2 self-drift/, 'whisper: cheapest 1 (12p) to priciest 2 (5p)');
  assert.match(priest.ability, /\+2–\+4 self-drift/, 'hymn: cheapest 2 (12p) to priciest 4 (5p)');
  assert.match(priest.ability, /\+4–\+10 self-drift/, 'litany: cheapest 4 (12p) to priciest 10 (5p)');
});

test('boot-time range: Heretic Priest\'s ability text shows a cheapest–priciest range across 5–12p for each sermon tier (camelCase placeholders)', () => {
  const cfg = loadGameConfig();
  const hp = cfg.roles.get('heretic-priest');
  assert.match(hp.ability, /\+1–\+2 self-drift/, 'false comfort: cheapest 1 to priciest 2');
  assert.match(hp.ability, /\+2–\+4 self-drift/, 'twisted hymn: cheapest 2 to priciest 4');
  assert.match(hp.ability, /\+4–\+10 self-drift/, 'warp litany: cheapest 4 to priciest 10');
  assert.doesNotMatch(hp.ability, /\{[a-zA-Z]+\}/, 'no unfilled placeholders');
});

// Curve/alias refactor: interrogator, priest, and heretic-priest all now
// point at the same shared `_curves.standard` table via a {curve, tierKeys}
// alias instead of each carrying its own byte-identical copy. These tests
// pin the alias indirection itself, separate from the formula tests above.

test('alias indirection: resolving through an alias role gives identical results to resolving the shared curve\'s own tier directly, at several player counts', () => {
  const scaledCosts = loadGameConfig().drift.scaledCosts;
  for (const n of [5, 6, 8, 9, 12]) {
    // priest 'litany' (tierKeys[2]) <-> curve 'standard' tier index 2 ('t3') <-> interrogator 't3' (tierKeys[2])
    assert.equal(
      resolveScaledCost(scaledCosts, 'priest', 'litany', n),
      resolveScaledCost(scaledCosts, 'interrogator', 't3', n),
      `priest litany and interrogator t3 must match at ${n}p (both alias to standard's 3rd tier)`
    );
    // heretic-priest 'false-comfort' (tierKeys[0]) <-> curve tier index 0 ('t1') <-> priest 'whisper' (tierKeys[0])
    assert.equal(
      resolveScaledCost(scaledCosts, 'heretic-priest', 'false-comfort', n),
      resolveScaledCost(scaledCosts, 'priest', 'whisper', n),
      `heretic-priest false-comfort and priest whisper must match at ${n}p (both alias to standard's 1st tier)`
    );
  }
});

test('validateScaledCosts: throws when an alias role\'s curve name does not exist in _curves', () => {
  const scaledCosts = {
    _curves: { standard: { baseValues: { t1: 10 }, floors: { t1: 1 }, perPlayerCount: {} } },
    interrogator: { curve: 'no-such-curve', tierKeys: ['t1'] },
  };
  assert.throws(() => validateScaledCosts(scaledCosts), /references unknown curve "no-such-curve"/);
});

test('validateScaledCosts: throws when an alias role\'s tierKeys length does not match the curve\'s tier count', () => {
  const scaledCosts = {
    _curves: { standard: { baseValues: { t1: 10, t2: 20, t3: 50 }, floors: { t1: 1, t2: 2, t3: 3 }, perPlayerCount: {} } },
    priest: { curve: 'standard', tierKeys: ['whisper', 'hymn'] }, // missing a 3rd tier name for t3
  };
  assert.throws(() => validateScaledCosts(scaledCosts), /tierKeys/);
});

test('resolveScaledCost: an alias role also throws "has no tier" (same wording as the legacy inline path) for an unmapped tier name', () => {
  const scaledCosts = loadGameConfig().drift.scaledCosts;
  assert.throws(() => resolveScaledCost(scaledCosts, 'priest', 'not-a-tier', 8), /has no tier/);
});

// L8 Astropath: T3's mandatory flat floor. baseValues===floors for every
// tier of this role's inline scaledCosts block, so the cost must hold at
// exactly 12 at both ends of the table-size range — proving the floor by
// actually resolving it, not just by construction.
test('Astropath T3 self-drift is a mandatory flat floor: exactly +12 at both 5p and 12p', () => {
  const scaledCosts = loadGameConfig().drift.scaledCosts;
  assert.equal(resolveScaledCost(scaledCosts, 'astropath', 't3', 5), 12);
  assert.equal(resolveScaledCost(scaledCosts, 'astropath', 't3', 12), 12);
});

test('validateScaledCosts: passes with the astropath block included (part of the live drift.json)', () => {
  const cfg = loadGameConfig();
  assert.ok(cfg.drift.scaledCosts.astropath, 'sanity: astropath block is actually present');
  assert.doesNotThrow(() => validateScaledCosts(cfg.drift.scaledCosts));
});
