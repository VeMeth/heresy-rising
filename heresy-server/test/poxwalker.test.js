import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

// H7 Poxwalker (roles/poxwalker.md v1.0.0, dispatch 2026-08-03).
//
// `random` is injectable precisely so the black-zone cripple coin is testable:
// PLAGUE_BLACK_CRIPPLE_CHANCE is 0.5, so a fixed 0.4 always cripples and a
// fixed 0.6 never does. Poxwalker ships as a custom-roster role (it is in no
// preset — same as Animus), so every fixture here passes an explicit roster.
function fixture({ count = 5, roster, random = () => 0.9 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-pox-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => 1_000_000, random });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) { manager.join({ code, playerCode: `p${i}`, name: `P${i}` }); manager.ready(code, `p${i}`, true); }
  manager.start(code, 'p0', { composition: { source: 'custom', roster } });
  manager.advance(code, 'p0');
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// Poxwalker + Murderer would be 2 Heretics against 3 Loyalists at 5p, which
// the parity win check ends on the first Loyalist death — so the standard
// 5p bed here is a solo-cabal Poxwalker.
const ROSTER_5 = ['poxwalker', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'];
const by = (f, roleId) => f.manager.players(f.code).find(p => p.role_id === roleId);
const drift = (f, p) => f.manager.player(f.code, p.player_code).drift;
const night = f => f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);

test('infect: rejected on a fellow Heretic, on self, and on the dead — no cost, no Patient Zero', () => {
  const f = fixture({ roster: ['poxwalker', 'murderer', 'priest', 'interrogator', 'chirurgeon'] });
  try {
    const pox = by(f, 'poxwalker'), murderer = by(f, 'murderer'), priest = by(f, 'priest');
    assert.throws(() => f.manager.submitAction(f.code, pox.player_code, { targetCode: murderer.player_code }), /not hostile/);
    assert.throws(() => f.manager.submitAction(f.code, pox.player_code, { targetCode: pox.player_code }), /not hostile/);
    f.manager.db.prepare('UPDATE hr_players SET alive=0 WHERE game_code=? AND player_code=?').run(f.code, priest.player_code);
    assert.throws(() => f.manager.submitAction(f.code, pox.player_code, { targetCode: priest.player_code }));
    assert.equal(f.manager.game(f.code).patient_zero, null, 'no Patient Zero set');
    assert.equal(drift(f, pox), 0, 'a rejected infect costs nothing');
  } finally { f.close(); }
});

test('infect: Patient Zero climbs +2 a night, Poxwalker pays +3 exactly once', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'interrogator');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.game(f.code).patient_zero, pz.player_code);
    assert.equal(drift(f, pox), 3, 'T3 self-cost, charged by the generic loop — not double-charged');
    assert.equal(drift(f, pz), 2, 'first plague tick lands the same night the infection does');

    night(f);
    f.manager.resolve(f.code, true);
    assert.equal(drift(f, pox), 2, 'Poxwalker slept: 3 - 1 recovery, no second infect cost');
    // Patient Zero also slept: -1 recovery then +2 plague. The net +1 for a
    // passive carrier is a real consequence of ordering, not a bug — see
    // POXWALKER_PLAN.md §4.3.
    assert.equal(drift(f, pz), 3, 'sleep recovery nets the passive climb down to +1');
  } finally { f.close(); }
});

test('infect: one per game, and no re-target while Patient Zero lives', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'interrogator'), other = by(f, 'priest');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    assert.throws(() => f.manager.submitAction(f.code, pox.player_code, { targetCode: other.player_code }), /already loosed|already has a host/);
  } finally { f.close(); }
});

test('visit: scanning Patient Zero costs the scan AND the carrier tick, and the carrier keeps ticking after', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), interrogator = by(f, 'interrogator');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);

    night(f);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: pz.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    // T1 scan at 5p is the scaled cost (2), plus +1 carrier on top of it.
    assert.equal(drift(f, interrogator), 3, 'scan cost + carrier tick, additive');
    assert.equal(f.manager.player(f.code, interrogator.player_code).plague_carrier, 1);

    // Stops visiting — still carries it.
    night(f);
    f.manager.resolve(f.code, true);
    assert.equal(drift(f, interrogator), 3, 'sleep -1 then carrier +1: the plague follows them home');
  } finally { f.close(); }
});

test('visited-by: Patient Zero\'s own night action infects the player they touch', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), victim = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, pz.player_code, { targetCode: victim.player_code, variant: 'whisper' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, victim.player_code).plague_carrier, 1, 'touched BY Patient Zero counts as a visit');
  } finally { f.close(); }
});

test('source death: new infections stop, existing carriers keep climbing', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), interrogator = by(f, 'interrogator'), citizen = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: pz.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    const carrierDrift = drift(f, interrogator);

    f.manager.db.prepare("UPDATE hr_players SET alive=0,death_cause='murder' WHERE game_code=? AND player_code=?").run(f.code, pz.player_code);
    night(f);
    // The Chirurgeon acts on a live player; nobody can touch the dead source
    // any more, which is exactly the point — the visit scan has nothing to
    // find, so no new carrier can be created.
    f.manager.submitAction(f.code, by(f, 'chirurgeon').player_code, { targetCode: citizen.player_code });
    f.manager.resolve(f.code, true);

    assert.equal(drift(f, interrogator), carrierDrift, 'carrier: sleep -1, plague +1 — still ticking with the source dead');
    assert.equal(f.manager.player(f.code, citizen.player_code).plague_carrier, 0, 'no new carriers once the source is gone');
  } finally { f.close(); }
});

test('black zone: 50% coin cripples for exactly one night, never kills', () => {
  const f = fixture({ roster: ROSTER_5, random: () => 0.4 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'interrogator');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    f.manager.db.prepare('UPDATE hr_players SET drift=20 WHERE game_code=? AND player_code=?').run(f.code, pz.player_code);
    night(f);
    f.manager.resolve(f.code, true);

    const after = f.manager.player(f.code, pz.player_code);
    assert.equal(after.cripple_tier, 1, 'coin landed (0.4 < 0.5)');
    assert.equal(after.alive, 1, 'the plague disables, it never kills');
    assert.equal(f.manager.game(f.code).phase, 'day');
    assert.equal(f.manager.player(f.code, pz.player_code).cripple_tier, 1, 'survives the day transition it was set on');
    night(f);
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, pz.player_code).cripple_tier, 0, 're-rolled, not stacked — it lapsed');
  } finally { f.close(); }
});

test('black zone: a losing coin leaves them alone, and the roll never downgrades torture damage', () => {
  const cold = fixture({ roster: ROSTER_5, random: () => 0.6 });
  try {
    const pox = by(cold, 'poxwalker'), pz = by(cold, 'interrogator');
    cold.manager.submitAction(cold.code, pox.player_code, { targetCode: pz.player_code });
    cold.manager.resolve(cold.code, true);
    cold.manager.db.prepare('UPDATE hr_players SET drift=20 WHERE game_code=? AND player_code=?').run(cold.code, pz.player_code);
    night(cold);
    cold.manager.resolve(cold.code, true);
    assert.equal(cold.manager.player(cold.code, pz.player_code).cripple_tier, 0, 'coin missed (0.6 >= 0.5)');
  } finally { cold.close(); }

  const hot = fixture({ roster: ROSTER_5, random: () => 0.4 });
  try {
    const pox = by(hot, 'poxwalker'), pz = by(hot, 'interrogator');
    hot.manager.submitAction(hot.code, pox.player_code, { targetCode: pz.player_code });
    hot.manager.resolve(hot.code, true);
    hot.manager.db.prepare('UPDATE hr_players SET drift=20,cripple_tier=3 WHERE game_code=? AND player_code=?').run(hot.code, pz.player_code);
    night(hot);
    hot.manager.resolve(hot.code, true);
    assert.equal(hot.manager.player(hot.code, pz.player_code).cripple_tier, 3, 'permanent torture damage is not overwritten by a plague tier 1');
  } finally { hot.close(); }
});

// Designer ruling 2026-08-04, overriding poxwalker.md v1.0.0's "full plague
// termination": curing the source does NOT cleanse anyone already carrying it.
// A cure and a coffin now behave identically — the source is gone either way
// and the contagion outlives it. Every carrier has to be cured individually.
test('cure: a protect on Patient Zero stops the source but carriers keep carrying it', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: pz.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, interrogator.player_code).plague_carrier, 1);

    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.game(f.code).patient_zero, null, 'source cleared');
    assert.equal(f.manager.player(f.code, interrogator.player_code).plague_carrier, 1, 'the carrier is NOT cleansed along with the source');

    // This is the regression that matters: resolvePlague must not early-return
    // on a null patient_zero, or losing the source silently freezes every
    // carrier. Sleep is -1 and the carrier tick is +1, so a still-ticking
    // carrier holds level while a frozen one would drop.
    const pzDrift = drift(f, pz), carrierDrift = drift(f, interrogator);
    night(f);
    f.manager.resolve(f.code, true);
    assert.ok(drift(f, pz) < pzDrift, 'the cured source stops climbing — sleep recovery only');
    assert.equal(drift(f, interrogator), carrierDrift, 'the carrier is still climbing: -1 sleep, +1 plague');
  } finally { f.close(); }
});

test('cure: with the source cured, no NEW carriers can be created', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), chirurgeon = by(f, 'chirurgeon'), citizen = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.game(f.code).patient_zero, null);

    // Priest sermons the Citizen. Were the Priest still Patient Zero this
    // would infect them ("visited-by"); cured, it must not.
    night(f);
    f.manager.submitAction(f.code, pz.player_code, { targetCode: citizen.player_code, variant: 'whisper' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, citizen.player_code).plague_carrier, 0, 'no live source, no new carriers');
  } finally { f.close(); }
});

test('cure: a protect on a carrier clears only that carrier; the source runs on', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: pz.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: interrogator.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, interrogator.player_code).plague_carrier, 0, 'that carrier is clean');
    assert.equal(f.manager.game(f.code).patient_zero, pz.player_code, 'source untouched');
  } finally { f.close(); }
});

test('cure: silent — the Chirurgeon\'s night report cannot be used to read plague state', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), chirurgeon = by(f, 'chirurgeon'), clean = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);

    const lines = target => {
      night(f);
      f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: target.player_code });
      f.manager.resolve(f.code, true);
      return f.manager.db.prepare("SELECT body FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id DESC LIMIT 1").get(f.code, chirurgeon.player_code).body;
    };
    const onClean = lines(clean);
    const onInfected = lines(pz);
    const g = f.manager.game(f.code);
    assert.equal(onClean, `Last night you protected ${f.manager.displayName(g, clean)}.`);
    assert.equal(onInfected, `Last night you protected ${f.manager.displayName(g, pz)}.`, 'same shape, no plague tell');
    assert.ok(!/pox|plague|cure|cleans/i.test(onInfected), 'nothing in the wording leaks the cure');
  } finally { f.close(); }
});

test('cure: a protect does NOT launder permanent torture damage', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest'), chirurgeon = by(f, 'chirurgeon');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    f.manager.db.prepare('UPDATE hr_players SET cripple_tier=3 WHERE game_code=? AND player_code=?').run(f.code, pz.player_code);
    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, pz.player_code).cripple_tier, 3, 'tier 3 lynch damage survives the cure — Tiered Lynch is not defeatable this way');
    assert.equal(f.manager.game(f.code).patient_zero, null, 'the plague itself still lifted');
  } finally { f.close(); }
});

test('recruiter flip on Patient Zero lifts the plague before the conversion lands', () => {
  const f = fixture({ count: 8, roster: ['poxwalker', 'recruiter', 'saboteur', 'priest', 'interrogator', 'chirurgeon', 'arbitrator', 'imperial-citizen'] });
  try {
    const pox = by(f, 'poxwalker'), recruiter = by(f, 'recruiter'), pz = by(f, 'interrogator');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);

    // skip_next_night as well as drift=20: the catalyst reads the target's
    // drift after the generic night loop, and a sleeping target's −1 recovery
    // would drop them under the Black gate before the check. Same idiom as the
    // existing catalyst test in game.test.js.
    f.manager.db.prepare('UPDATE hr_players SET drift=20,skip_next_night=1 WHERE game_code=? AND player_code=?').run(f.code, pz.player_code);
    night(f);
    f.manager.submitAction(f.code, recruiter.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, pz.player_code).faction, 'heretic', 'flip landed');
    assert.equal(f.manager.game(f.code).patient_zero, null, 'plague lifted first — no infected Heretic');
  } finally { f.close(); }
});

test('zone cue: an infected player gets the plague line INSTEAD of the ordinary one — one message, not two', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'interrogator');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);

    // Park Patient Zero just under Orange so the next plague tick crosses it.
    f.manager.db.prepare('UPDATE hr_players SET drift=9 WHERE game_code=? AND player_code=?').run(f.code, pz.player_code);
    night(f);
    f.manager.resolve(f.code, true);

    const crossings = f.manager.db.prepare("SELECT body,meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id").all(f.code, pz.player_code)
      .filter(m => m.meta && JSON.parse(m.meta).ownZone === 'orange');
    assert.equal(crossings.length, 1, 'exactly one message for one crossing — a second would leak infection by message count');
    assert.match(crossings[0].body, /veins darken/, 'the plague cue, not the ordinary hint');
    assert.equal(JSON.parse(crossings[0].meta).ownZone, 'orange', 'ownZone meta preserved — the client taint gauge reads it');

    // A clean player crossing the same boundary still gets the ordinary line.
    const clean = by(f, 'imperial-citizen');
    f.manager.db.prepare('UPDATE hr_players SET drift=9 WHERE game_code=? AND player_code=?').run(f.code, clean.player_code);
    f.manager.changeDrift(f.code, clean.player_code, 1, 'test');
    const cleanMsg = f.manager.db.prepare("SELECT body FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id DESC LIMIT 1").get(f.code, clean.player_code);
    assert.doesNotMatch(cleanMsg.body, /veins darken/, 'uninfected players never see the plague cue');
  } finally { f.close(); }
});

test('plague state never leaks into another player\'s view', () => {
  const f = fixture({ roster: ROSTER_5 });
  try {
    const pox = by(f, 'poxwalker'), pz = by(f, 'priest');
    f.manager.submitAction(f.code, pox.player_code, { targetCode: pz.player_code });
    f.manager.resolve(f.code, true);
    for (const viewer of f.manager.players(f.code)) {
      const json = JSON.stringify(f.manager.state(f.code, viewer.player_code));
      assert.equal(json.includes('plague'), false, `plague state visible to ${viewer.role_id}`);
      assert.equal(json.includes('patientZero') || json.includes('patient_zero'), false);
    }
    assert.equal(JSON.stringify(f.manager.spectate(f.code)).includes('plague'), false, 'spectators too');
  } finally { f.close(); }
});
