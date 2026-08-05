// L8 Astropath (locked spec, 2026-08-05). Names-only visitor intel read off
// hr_actions, the same durable per-round action log the Chirurgeon/
// Interrogator rotation checks already query (mechanics/protection.js).
// Astropath ships as a custom-roster role in v1 (no preset slot yet — same
// as Animus), so every fixture here passes an explicit roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture({ count = 5, roster, random = () => 0.9 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-astropath-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => 1_000_000, random });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) { manager.join({ code, playerCode: `p${i}`, name: `P${i}` }); manager.ready(code, `p${i}`, true); }
  manager.start(code, 'p0', { composition: { source: 'custom', roster } });
  manager.advance(code, 'p0');
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const by = (f, roleId) => f.manager.players(f.code).find(p => p.role_id === roleId);
const drift = (f, p) => f.manager.player(f.code, p.player_code).drift;
const night = f => f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);
const lastPrivate = (f, recipientCode) => f.manager.db.prepare(
  "SELECT body, meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id DESC LIMIT 1"
).get(f.code, recipientCode);
const privateCount = (f, recipientCode, filterFn) => f.manager.db.prepare(
  "SELECT body, meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=?"
).all(f.code, recipientCode).filter(m => !filterFn || filterFn(m)).length;

// 6p: astropath + murderer (1 heretic) + 4 loyalists, one of which
// (imperial-citizen) plays "Player X", the astropath's read target.
const ROSTER_6 = ['astropath', 'murderer', 'interrogator', 'chirurgeon', 'priest', 'imperial-citizen'];

test('T1: read on X after Night 1 returns exactly the names that targeted X that night, no others', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'imperial-citizen'), priest = by(f, 'priest');
    // Night 1: Interrogator and Chirurgeon both target X; Priest targets someone else (noise).
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
    f.manager.submitAction(f.code, priest.player_code, { targetCode: interrogator.player_code, variant: 'whisper' });
    f.manager.resolve(f.code, true);

    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    const priestName = f.manager.displayName(g, f.manager.player(f.code, priest.player_code));
    assert.ok(msg.body.includes(interrogatorName), 'Interrogator visited X, must appear');
    assert.ok(msg.body.includes(chirurgeonName), 'Chirurgeon visited X, must appear');
    assert.ok(!msg.body.includes(priestName), 'Priest did not visit X, must not appear');
    const meta = JSON.parse(msg.meta);
    assert.equal(meta.intelKind, 'warp-read');
    assert.equal(meta.tier, 1);
    assert.equal(meta.target, x.player_code);
  } finally { f.close(); }
});

test('T2: deduped union of visitors across the last two nights, no per-night attribution', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'imperial-citizen');
    // Night 1: Interrogator visits X.
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    // Night 2: Chirurgeon visits X (different visitor).
    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
    f.manager.resolve(f.code, true);

    // Night 3: Astropath T2-reads X — window is [round1, round2].
    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T2' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    assert.ok(msg.body.includes(interrogatorName), 'Night-1 visitor present in the union');
    assert.ok(msg.body.includes(chirurgeonName), 'Night-2 visitor present in the union');
    const meta = JSON.parse(msg.meta);
    assert.equal(meta.tier, 2);
  } finally { f.close(); }
});

test('T3: same two-night visitors, but separated by which night they visited', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
    f.manager.resolve(f.code, true);

    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T3' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    // Attribution: the older night (round 1, Interrogator) is called out
    // separately from the more recent night (round 2, Chirurgeon) — assert
    // each name sits in its own clause, not just "both present somewhere".
    const parts = msg.body.split('. ');
    const recentClause = parts.find(p => /night past/i.test(p)) || '';
    const olderClause = parts.find(p => /night before/i.test(p)) || '';
    assert.ok(recentClause.includes(chirurgeonName), 'Chirurgeon (round 2, most recent) attributed to the recent-night clause');
    assert.ok(olderClause.includes(interrogatorName), 'Interrogator (round 1, older) attributed to the older-night clause');
    assert.ok(!recentClause.includes(interrogatorName), 'no cross-contamination: older visitor not in the recent clause');
    assert.ok(!olderClause.includes(chirurgeonName), 'no cross-contamination: recent visitor not in the older clause');
    const meta = JSON.parse(msg.meta);
    assert.equal(meta.tier, 3);
  } finally { f.close(); }
});

test('T3 self-drift cost is exactly +12 at 5p', () => {
  const roster5 = ['astropath', 'murderer', 'priest', 'interrogator', 'chirurgeon'];
  const f = fixture({ count: 5, roster: roster5 });
  try {
    const astropath = by(f, 'astropath'), target = by(f, 'priest');
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: target.player_code, variant: 'T3' });
    f.manager.resolve(f.code, true);
    assert.equal(drift(f, astropath), 12, 'T3 floor holds at 5p');
  } finally { f.close(); }
});

test('T3 self-drift cost is exactly +12 at 12p (proving the floor never shrinks at a full table)', () => {
  const roster12 = ['astropath', 'murderer', 'heretic-priest', 'conspirator', 'saboteur', 'recruiter', 'sanctioned-psyker', 'priest', 'interrogator', 'chirurgeon', 'novice-psychic', 'arbitrator'];
  const f = fixture({ count: 12, roster: roster12 });
  try {
    const astropath = by(f, 'astropath'), target = by(f, 'priest');
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: target.player_code, variant: 'T3' });
    f.manager.resolve(f.code, true);
    assert.equal(drift(f, astropath), 12, 'T3 floor holds unshrunk at 12p');
  } finally { f.close(); }
});

test('crippled astropath: warp-read is silently rejected — no drift change, no intel message', () => {
  const roster5 = ['astropath', 'murderer', 'priest', 'interrogator', 'chirurgeon'];
  const f = fixture({ count: 5, roster: roster5 });
  try {
    const astropath = by(f, 'astropath'), target = by(f, 'priest');
    f.manager.db.prepare('UPDATE hr_players SET cripple_tier=2 WHERE game_code=? AND player_code=?').run(f.code, astropath.player_code);
    const before = privateCount(f, astropath.player_code, m => m.meta && JSON.parse(m.meta).intelKind === 'warp-read');
    const result = f.manager.submitAction(f.code, astropath.player_code, { targetCode: target.player_code, variant: 'T1' });
    assert.equal(result.silent, true);
    assert.equal(result.kind, 'warp-read');
    assert.equal(drift(f, astropath), 0, 'crippled astropath paid no drift at submission');
    f.manager.resolve(f.code, true);
    // changeDrift floors at 0, so starting drift 0 + sleep recovery (-1)
    // still reads 0 — the point is it did NOT get the T1 scaled cost (+3),
    // confirming the crippled action never entered hr_actions to be resolved.
    assert.equal(drift(f, astropath), 0, 'sleep recovery only (floored at 0) — no T1 scaled cost was ever charged');
    const after = privateCount(f, astropath.player_code, m => m.meta && JSON.parse(m.meta).intelKind === 'warp-read');
    assert.equal(after, before, 'no intel message was ever sent');
  } finally { f.close(); }
});

test('self-target rejected: warp-read on yourself throws (mirrors the generic target:"other" self-target ban)', () => {
  const roster5 = ['astropath', 'murderer', 'priest', 'interrogator', 'chirurgeon'];
  const f = fixture({ count: 5, roster: roster5 });
  try {
    const astropath = by(f, 'astropath');
    assert.throws(() => f.manager.submitAction(f.code, astropath.player_code, { targetCode: astropath.player_code, variant: 'T1' }), /Choose another player/);
  } finally { f.close(); }
});

test('no-reveal guarantee: the intel payload never carries a visitor\'s action kind or faction, only names/tier/target', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), x = by(f, 'imperial-citizen');
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    const msg = lastPrivate(f, astropath.player_code);
    const meta = JSON.parse(msg.meta);
    assert.deepEqual(Object.keys(meta).sort(), ['intelKind', 'target', 'tier'], 'meta carries only names/tier/target-shaped fields, nothing else');
    assert.equal('kind' in meta, false, 'no visitor action kind leaked');
    assert.equal('faction' in meta, false, 'no visitor faction leaked');
    assert.doesNotMatch(msg.body, /investigate|scan_drift|drift-hint|protect|loyalist|heretic/i, 'wording itself does not leak action kind or alignment');
  } finally { f.close(); }
});

// Saboteur trap-blocking for warp-read. trapBlocks() (heresyGameManager.js)
// keys off the SCANNED action's target_code, not the actor — mirrored here
// from the existing scaled-costs.test.js Interrogator trap test ("Trap goes
// on the SCAN TARGET, not the [scanner]"). No pre-existing test covers
// trap-blocking for investigate/drift-hint directly, so this is a new
// pattern for intel-kind actions, built straight off trapBlocks' code path
// (it suppresses resolveIntel entirely and charges TRAP_DRIFT to the actor).
test('trapped scan: a Saboteur trap on the read target suppresses the intel and charges TRAP_DRIFT to the astropath', () => {
  const f = fixture({ count: 8, roster: ['astropath', 'murderer', 'saboteur', 'priest', 'interrogator', 'chirurgeon', 'novice-psychic', 'arbitrator'] });
  try {
    const astropath = by(f, 'astropath'), saboteur = by(f, 'saboteur'), x = by(f, 'priest');
    f.manager.submitAction(f.code, saboteur.player_code, { targetCode: x.player_code });
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    assert.equal(drift(f, astropath), 3 + 5, 'T1 scaled cost (3, flat floor) + TRAP_DRIFT (5)');
    const msg = lastPrivate(f, astropath.player_code);
    assert.ok(!msg || !(msg.meta && JSON.parse(msg.meta).intelKind === 'warp-read'), 'no intel message reached the astropath — the trap suppressed resolveIntel entirely');
  } finally { f.close(); }
});
