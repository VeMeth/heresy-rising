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

// v1.1.0 T1 reads Night N (the night being resolved, the night the Astropath
// submits) and returns ONE visitor picked at random from the visitor list.
// The Astropath's own warp-read on that same target for the same night is
// filtered OUT of the visitor list — see mechanics/astropath.js.
test('T1 (v1.1.0): reads Night N (the night the Astropath submits) and returns exactly one random visitor from that night', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'imperial-citizen'), priest = by(f, 'priest');
    // Night 1: Interrogator and Chirurgeon both target X; Priest targets someone else (noise).
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
    f.manager.submitAction(f.code, priest.player_code, { targetCode: interrogator.player_code, variant: 'whisper' });
    // Night 1 also has the Astropath's own warp-read on X — its actor_code
    // is the Astropath, who is also one of the would-be visitors if not for
    // the kind<>'warp-read' filter.
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    const priestName = f.manager.displayName(g, f.manager.player(f.code, priest.player_code));
    const astropathName = f.manager.displayName(g, astropath);
    // Exactly one visitor surfaced — must be one of the real Night-1
    // visitors (Interrogator, Chirurgeon) and not a non-visitor (Priest) or
    // the Astropath's own read.
    const named = [interrogatorName, chirurgeonName].filter(n => msg.body.includes(n));
    assert.equal(named.length, 1, `T1 returns exactly one of [${interrogatorName}, ${chirurgeonName}] — got: ${msg.body}`);
    assert.ok(!msg.body.includes(priestName), 'Priest did not visit X, must not appear');
    assert.ok(!msg.body.includes(astropathName), 'Astropath\'s own warp-read on X must not surface as a "visitor" of X');
    const meta = JSON.parse(msg.meta);
    assert.equal(meta.intelKind, 'warp-read');
    assert.equal(meta.tier, 1);
    assert.equal(meta.target, x.player_code);
  } finally { f.close(); }
});

// T1 over many seeded runs covers the random pick — with two real visitors
// on the target, every visitor must appear at least once across enough runs
// to make a uniform-sample bug obvious. Needs at least one heretic in the
// roster so the game doesn't finishIfWon on Day 1 before night actions fire.
// Custom rosters shuffle role-to-seat assignments (see heresyGameManager.js
// around `shuffle(ids)` in the custom-roster branch of game:start), so the
// names are randomized across runs — assert against the visitor list rather
// than against fixed players.
test('T1 (v1.1.0): the random pick is a uniform sample — every Night-N visitor surfaces at least once across many runs', () => {
  const ROSTER = ['astropath', 'murderer', 'interrogator', 'chirurgeon', 'priest'];
  let interrogatorName, chirurgeonName;
  const surfaced = new Set();
  for (let trial = 0; trial < 64; trial++) {
    const f = fixture({ count: 5, roster: ROSTER, random: Math.random });
    try {
      const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'priest'), priest = by(f, 'priest'), murderer = by(f, 'murderer');
      // Visitors on x tonight: interrogator (T1 scan) + chirurgeon (protect).
      // The Astropath's own warp-read on x is filtered out of the visitor
      // list. The Priest targets the Murderer (not x), the Murderer sleeps.
      f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
      f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
      f.manager.submitAction(f.code, priest.player_code, { targetCode: murderer.player_code, variant: 'whisper' });
      f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T1' });
      f.manager.resolve(f.code, true);
      const g = f.manager.game(f.code);
      const msg = lastPrivate(f, astropath.player_code);
      interrogatorName = f.manager.displayName(g, interrogator);
      chirurgeonName = f.manager.displayName(g, chirurgeon);
      // Extract the surfaced visitor from the cue text — "you taste {NAME}
      // lingering on {target}'s shadow tonight". A bare-word match against
      // the body would false-positive on the target reference ("P1's shadow")
      // for anyone whose display name happens to appear as a substring, so
      // pull just the name after "taste ".
      const surfacedName = (msg.body.match(/you taste ([^\s]+)/) || [])[1];
      assert.ok(surfacedName, `cue text didn't surface a name: ${msg.body}`);
      assert.ok([interrogatorName, chirurgeonName].includes(surfacedName), `T1 surfaced "${surfacedName}" — must be one of [${interrogatorName}, ${chirurgeonName}]. body: ${msg.body}`);
      surfaced.add(surfacedName);
    } finally { f.close(); }
  }
  assert.ok(surfaced.has(interrogatorName) && surfaced.has(chirurgeonName), `T1 must sample uniformly across both visitors — only saw [${[...surfaced].join(', ')}]`);
});

// v1.1.0 T1 with zero Night-N visitors returns the empty result message and
// still charges the scaled cost (drift is charged at the generic per-player
// loop in resolveNight, before resolveIntel even runs).
test('T1 (v1.1.0): empty visitor list returns the no-one message and still charges the T1 drift cost', () => {
  const f = fixture({ count: 6, roster: ['astropath', 'murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'] });
  try {
    const astropath = by(f, 'astropath'), target = by(f, 'priest');
    // Nobody targets target tonight — just the Astropath's own read, which
    // is filtered out of the visitor list.
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: target.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    const msg = lastPrivate(f, astropath.player_code);
    assert.match(msg.body, /No one crossed/, 'empty-visitor cue text');
    assert.equal(drift(f, astropath), 3, 'T1 cost charged even when the visitor list is empty');
  } finally { f.close(); }
});

// v1.1.0 T2 window = Night N ∪ N-1 (the night the Astropath submits and the
// night before). The Astropath's own warp-read on Night N is filtered out of
// the union, so it doesn't pollute the result.
test('T2 (v1.1.0): deduped union across Night N ∪ N-1, no per-night attribution, Astropath\'s own read excluded', () => {
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

    // Night 3: Astropath T2-reads X — window is [round 2, round 3].
    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T2' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    const astropathName = f.manager.displayName(g, astropath);
    assert.ok(!msg.body.includes(interrogatorName), 'Night-1 visitor out of the new [N, N-1] window');
    assert.ok(msg.body.includes(chirurgeonName), 'Night-2 visitor (the night before) is in [N, N-1]');
    assert.ok(!msg.body.includes(astropathName), 'Astropath\'s own warp-read on Night N must not surface');
    const meta = JSON.parse(msg.meta);
    assert.equal(meta.tier, 2);
  } finally { f.close(); }
});

// v1.1.0 T3 attributes visitors to Night N ("tonight") vs Night N-1
// ("the night before"). The Astropath's own warp-read on Night N is filtered
// out of the tonight clause.
test('T3 (v1.1.0): tonight vs the-night-before attribution, Astropath\'s own read excluded from tonight', () => {
  const f = fixture({ count: 6, roster: ROSTER_6 });
  try {
    const astropath = by(f, 'astropath'), interrogator = by(f, 'interrogator'), chirurgeon = by(f, 'chirurgeon'), x = by(f, 'imperial-citizen');
    // Night 1: Interrogator visits X.
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);

    // Night 2: Chirurgeon visits X.
    night(f);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: x.player_code });
    f.manager.resolve(f.code, true);

    // Night 3: Astropath T3-reads X — tonight (round 3) vs the night before (round 2).
    // The Astropath's own round-3 warp-read on X is filtered out of the
    // tonight visitor list (see mechanics/astropath.js).
    night(f);
    f.manager.submitAction(f.code, astropath.player_code, { targetCode: x.player_code, variant: 'T3' });
    f.manager.resolve(f.code, true);

    const g = f.manager.game(f.code);
    const msg = lastPrivate(f, astropath.player_code);
    const interrogatorName = f.manager.displayName(g, f.manager.player(f.code, interrogator.player_code));
    const chirurgeonName = f.manager.displayName(g, f.manager.player(f.code, chirurgeon.player_code));
    const astropathName = f.manager.displayName(g, astropath);
    const parts = msg.body.split('. ');
    const tonightClause = parts.find(p => /^Tonight/i.test(p)) || '';
    const priorClause = parts.find(p => /night before/i.test(p)) || '';
    // Chirurgeon visited X on round 2 = the night before this read.
    assert.ok(priorClause.includes(chirurgeonName), 'Chirurgeon (round 2 = the night before) attributed to the night-before clause');
    // Tonight (round 3) had only the Astropath's own read, which is filtered out — so the tonight clause should name no one.
    assert.ok(!tonightClause.includes(interrogatorName), 'Night-1 visitor (now two nights back) not in tonight');
    assert.ok(!tonightClause.includes(chirurgeonName), 'Night-2 visitor not misattributed to tonight');
    assert.ok(!msg.body.includes(astropathName), 'Astropath\'s own warp-read must not surface in either clause');
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
    // Both submit on the same night so v1.1.0 T1 (which reads Night N)
    // has a real visitor to surface. The Astropath's own read is filtered
    // out of the visitor list (kind<>'warp-read'), so the only surfaced
    // name is the Interrogator's.
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: x.player_code, variant: 'T1' });
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
