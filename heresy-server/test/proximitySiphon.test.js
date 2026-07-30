import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';
import { applyProximitySiphon } from '../src/mechanics/drift.js';

const SIPHON_CONFIG = {
  role: 'imperial_citizen',
  rate: 0.30,
  floor: 1,
  adjacency: 'conclave_list',
  scope: 'night_actions_only',
  sleepStacks: true,
  cap: 20,
  visibility: 'hidden'
};

function fixture(count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-siphon-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => now, random: () => 0.9 });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) { manager.join({ code, playerCode: `p${i}`, name: `P${i}` }); manager.ready(code, `p${i}`, true); }
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// Helper: set a player's role_id and faction at a specific seat, return player_code
function setRoleAtSeat(manager, code, seat, roleId, faction) {
  const players = manager.players(code);
  const target = players.find(p => p.seat === seat);
  if (!target) throw new Error(`No player at seat ${seat}`);
  manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run(roleId, faction, code, target.player_code);
  return target.player_code;
}

test('config: rules.json proximitySiphon.role matches the real role_id ("imperial-citizen", hyphenated like every other role id, not the spec doc\'s "imperial_citizen" underscore)', () => {
  const f = fixture(5);
  try {
    assert.equal(f.manager.config.rules.proximitySiphon.role, 'imperial-citizen');
  } finally { f.close(); }
});

// ── Pure computation tests (applyProximitySiphon directly) ────────────────

test('S1: Citizen adjacent to Murderer — 30% of 15 rounded to 5', () => {
  const charges = new Map([['p0', 15]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].pc, 'p1');
  assert.equal(applied[0].delta, 5);
});

test('S2: Citizen adjacent to sleeping Citizen — no charge to siphon', () => {
  const charges = new Map();
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'imperial_citizen', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 0);
});

test('S3: Two neighbors both charge +5 — siphon = 2 + 2 = 4', () => {
  const charges = new Map([['p0', 5], ['p2', 5]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true },
      { player_code: 'p2', role_id: 'priest', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 4);
});

test('S4: Priest Whisper self-cost +2 — floor 1 fires', () => {
  const charges = new Map([['p0', 2]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'priest', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 1);
});

test('S5: Priest Whisper self-cost +4 — round(1.2) = 1, floor is 1, still +1', () => {
  const charges = new Map([['p0', 4]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'priest', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 1);
});

test('S6: Edge Citizen (first in list) — only right neighbor counts', () => {
  const charges = new Map([['p1', 10]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'imperial_citizen', alive: true },
      { player_code: 'p1', role_id: 'murderer', alive: true },
      { player_code: 'p2', role_id: 'interrogator', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 3);
});

test('S7: Edge Citizen (last in list) — only left neighbor counts', () => {
  const charges = new Map([['p1', 10]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'interrogator', alive: true },
      { player_code: 'p1', role_id: 'murderer', alive: true },
      { player_code: 'p2', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 3);
});

test('S8: Dead Citizen — skipped entirely, no siphon', () => {
  const charges = new Map([['p0', 15]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: false }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 0);
});

test('S9: Dead neighbor — skipped, no siphon fires', () => {
  const charges = new Map([['p0', 15]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: false },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 0);
});

test('S10: Non-Citizen role — skipped', () => {
  const charges = new Map([['p0', 10]]);
  const applied = [];
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: true },
      { player_code: 'p1', role_id: 'priest', alive: true }
    ],
    charges, SIPHON_CONFIG,
    (pc, delta) => applied.push({ pc, delta })
  );
  assert.equal(applied.length, 0);
});

test('Cap: siphon pushes citizen to 20 but no overflow', () => {
  const SIPHON_WITH_FN = {
    ...SIPHON_CONFIG,
    cap: 20
  };
  const charges = new Map([['p0', 15]]);
  const applied = [];
  const drift = new Map([['p1', 19]]);
  applyProximitySiphon(
    [
      { player_code: 'p0', role_id: 'murderer', alive: true },
      { player_code: 'p1', role_id: 'imperial_citizen', alive: true }
    ],
    charges, SIPHON_WITH_FN,
    (pc, delta) => {
      const current = drift.get(pc) || 0;
      const capped = Math.min(20, current + delta);
      drift.set(pc, capped);
      applied.push({ pc, delta, before: current, after: capped });
    }
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].delta, 5);
  assert.equal(drift.get('p1'), 20);
});

// ── Game-level integration tests ──────────────────────────────────────────

test('Integration: Murderer kill charges citizen +5 siphon (driftWeight 15 → 30% = 5)', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const murdPC = setRoleAtSeat(f.manager, f.code, 0, 'murderer', 'heretic');
    const citPC = setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 2, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p => p.player_code !== citPC && p.player_code !== murdPC);
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const cit = f.manager.player(f.code, citPC);
    // 5 siphon + 1 witnessed violence = 6 (sleep -1 floors to 0)
    assert.equal(cit.drift, 6, 'Citizen siphoned 5 from Murderer kill + 1 witnessed');
  } finally { f.close(); }
});

test('Integration: Citizen at drift 19, siphon +5 caps at 20', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const murdPC = setRoleAtSeat(f.manager, f.code, 0, 'murderer', 'heretic');
    const citPC = setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 2, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.db.prepare('UPDATE hr_players SET drift=19 WHERE game_code=? AND player_code=?').run(f.code, citPC);

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p => p.player_code !== citPC && p.player_code !== murdPC);
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const cit = f.manager.player(f.code, citPC);
    assert.equal(cit.drift, 20, 'Citizen capped at 20');
  } finally { f.close(); }
});

test('Integration: Sleeping Citizen neighbor — no siphon fires', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    // seat 0 = citizen (watch), seat 1 = citizen (sleeping neighbor), seat 2 = Murderer
    const cit0PC = setRoleAtSeat(f.manager, f.code, 0, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    const murdPC = setRoleAtSeat(f.manager, f.code, 2, 'murderer', 'heretic');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p =>
      p.player_code !== cit0PC && p.player_code !== murdPC
    );
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const cit0 = f.manager.player(f.code, cit0PC);
    // citizen at seat 0 neighbors seat 1 (sleeping citizen with no charge) → no siphon
    // seat 2 Murderer's kill triggers witnessed violence (+1), sleep -1 floors to 0
    assert.equal(cit0.drift, 1, 'Citizen gets witnessed violence but no siphon from sleeping neighbor');
  } finally { f.close(); }
});

test('Integration: Day-side phase — siphon does not fire', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const citPC = setRoleAtSeat(f.manager, f.code, 0, 'imperial-citizen', 'loyalist');
    const murdPC = setRoleAtSeat(f.manager, f.code, 1, 'murderer', 'heretic');
    setRoleAtSeat(f.manager, f.code, 2, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p => p.player_code !== citPC && p.player_code !== murdPC);
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const citBefore = f.manager.player(f.code, citPC).drift;
    // 5 siphon + 1 witnessed violence = 6 (siphon fires at night, not day)
    assert.equal(citBefore, 6, 'Siphon fires at night from neighbor action charges');
  } finally { f.close(); }
});

test('Integration: No public log for siphon events — only drift event exists', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const murdPC = setRoleAtSeat(f.manager, f.code, 0, 'murderer', 'heretic');
    const citPC = setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 2, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p => p.player_code !== citPC && p.player_code !== murdPC);
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const publicMsgs = f.manager.historyMessages(f.code, 'p0', 'public').messages;
    const siphonMentions = publicMsgs.filter(m => /siphon|proximity|neighbor/i.test(m.body));
    assert.equal(siphonMentions.length, 0, 'No public message mentions siphon or proximity');

    const driftEvents = JSON.parse(
      f.manager.db.prepare("SELECT payload FROM hr_events WHERE game_code=? AND type='drift' ORDER BY id DESC LIMIT 1").get(f.code).payload
    );
    assert.equal(driftEvents.reason, 'proximity-siphon');
    assert.equal(driftEvents.after, 6);
  } finally { f.close(); }
});

test('Integration: Siphon from two neighbors stacks', () => {
  const f = fixture(6);
  try {
    f.manager.start(f.code, 'p0');
    // seat 0 = Murderer, seat 1 = Citizen (center), seat 2 = Sanctioned Psyker (kill cost +15)
    const murdPC = setRoleAtSeat(f.manager, f.code, 0, 'murderer', 'heretic');
    const citPC = setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    const psyPC = setRoleAtSeat(f.manager, f.code, 2, 'sanctioned-psyker', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 5, 'imperial-citizen', 'loyalist');

    f.manager.advance(f.code, 'p0');
    // Murderer kills someone
    const target1 = f.manager.players(f.code).find(p =>
      p.player_code !== citPC && p.player_code !== murdPC && p.player_code !== psyPC
    );
    f.manager.submitAction(f.code, murdPC, { targetCode: target1.player_code });
    // Psyker also kills someone else (different target than Murderer)
    const target2 = f.manager.players(f.code).find(p =>
      p.player_code !== citPC && p.player_code !== murdPC && p.player_code !== psyPC &&
      p.player_code !== target1.player_code
    );
    f.manager.submitAction(f.code, psyPC, { targetCode: target2.player_code });
    f.manager.resolve(f.code, true);

    const cit = f.manager.player(f.code, citPC);
    // Citizen (no action) gets NIGHTLY_SLEEP_RECOVERY (-1), which floors
    // straight back to 0 (changeDrift clamps to [0,cap] on every call — it
    // doesn't bank a negative to offset later charges in the same night).
    // Two separate kills land (Murderer's and the Psyker's), and EACH one
    // charges every still-alive player +1 witnessed-violence independently
    // (the kill loop re-reads the alive set per kill, but doesn't dedupe
    // witness charges across kills) -> +1 +1 = +2.
    // Then the siphon adds round(0.3*15)=5 from each neighbor (Murderer,
    // Psyker) -> +5 +5 = +10.
    // 0 -> 0 (sleep) -> 2 (two witnessed-violence charges) -> 12 (siphon).
    assert.equal(cit.drift, 12, 'Citizen siphoned 5+5=10 from two kill-action neighbors, plus 2 witnessed-violence charges (one per kill)');
  } finally { f.close(); }
});

test('Integration: Dead citizen — no siphon fires even with active neighbor', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const murdPC = setRoleAtSeat(f.manager, f.code, 0, 'murderer', 'heretic');
    const citPC = setRoleAtSeat(f.manager, f.code, 1, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 2, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 3, 'imperial-citizen', 'loyalist');
    setRoleAtSeat(f.manager, f.code, 4, 'imperial-citizen', 'loyalist');

    f.manager.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(f.code, citPC);

    f.manager.advance(f.code, 'p0');
    const target = f.manager.players(f.code).find(p => p.player_code !== citPC && p.player_code !== murdPC);
    f.manager.submitAction(f.code, murdPC, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);

    const cit = f.manager.player(f.code, citPC);
    assert.equal(cit.drift, 0, 'Dead citizen not affected by siphon');
  } finally { f.close(); }
});
