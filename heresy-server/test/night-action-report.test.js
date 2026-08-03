// Bugfix round §1, §3 (server), §4, §5 — coverage for:
//   - second-person cripple text, auto-filed under the victim's own dossier
//   - the reworded Interrogator T2 result (two facts, clearly separated)
//   - per-actor "what you did last night" morning reports (§3b)
//   - own_action filing and the auto-bookmark budget being separate from the
//     manual one (§3a/§3c)
//   - the bookmark:added-style emit contract (§4), tested here at the
//     manager/listener level (index.js's socket wiring is a thin forward)
//
// Hard constraint threaded through every night-action-report test below:
// the reported line names only the CHOICE the actor made, never how it
// resolved. Several tests below assert byte-identical wording across an
// action landing vs. being blocked/gated/fizzled specifically to prove that.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture(count = 8) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-nar-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => 1_000_000, random: () => 0.9 });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) {
    manager.join({ code, playerCode: `p${i}`, name: `P${i}` });
    manager.ready(code, `p${i}`, true);
  }
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function privMsgs(f, playerCode) {
  return f.manager.db.prepare("SELECT * FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id").all(f.code, playerCode);
}

// ── §1: cripple message is second person and files under the victim ───────

test('cripple: bloodRitualCripple text reads in second person and is auto-filed under the victim\'s own dossier entry', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const saboteur = f.manager.players(f.code).find(p => p.role_id === 'saboteur');
    const target = f.manager.players(f.code).find(p => p.faction === 'loyalist');
    f.manager.submitFactionAction(f.code, saboteur.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, target.player_code).cripple_tier, 1, 'precondition: fresh cripple landed');
    const msgs = privMsgs(f, target.player_code);
    const crippleMsg = msgs.find(m => /crumpled|beaten|staggered|woke broken/i.test(m.body));
    assert.ok(crippleMsg, 'the cripple flavor text was delivered privately');
    assert.doesNotMatch(crippleMsg.body, /^P\d/, 'not third person — does not open by naming the victim');
    assert.match(crippleMsg.body, /^You /, 'reads in second person');
    const filed = f.manager.listNotes(f.code, target.player_code).bookmarks.find(b => b.messageId === crippleMsg.id);
    assert.ok(filed, 'auto-filed — the reporter believed this was missing entirely');
    assert.equal(filed.subjectCode, target.player_code, 'filed under the victim\'s OWN dossier entry, not the subjectless General bucket');
    assert.equal(filed.auto, 1);
  } finally { f.close(); }
});

// ── §5: Interrogator T2 result keeps both facts but stops implying one is
//    evidence for the other ─────────────────────────────────────────────

test('interrogate: effectiveTier>=2 result separates the faction read from the drift-zone read, keeps meta byte-shaped, adds no new info', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    // T2 (intensity 2) against a GREEN target (zoneUpgrade 0) -> effectiveTier
    // = min(3, 2+0) = 2 exactly: past the T1 special-case, short of the T3
    // "Confirmed" branch, landing squarely in the reworded noisy-result text.
    // Green also keeps this off the Execute-on-Sight path (needs zoneUpgrade>=2).
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
    f.manager.db.prepare('UPDATE hr_players SET drift=0,faction=? WHERE game_code=? AND player_code=?').run('heretic', f.code, target.player_code);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T2' });
    f.manager.resolve(f.code, true);
    const state = f.manager.state(f.code, interrogator.player_code);
    const result = state.privateMessages.find(m => m.meta?.intelKind === 'interrogate' && m.meta?.effectiveTier === 2);
    assert.ok(result, 'the T2 interrogate result was delivered');
    assert.match(result.body, /does not add up/, 'faction-hint sentence still present (deterministic: rate=0 at green/fresh actor drift)');
    assert.match(result.body, /Green/, 'drift-zone reading still present, and capitalized properly');
    assert.match(result.body, /Separately/, 'the two facts read as distinct signals, not one flowing into the other');
    assert.doesNotMatch(result.body, /does not add up\. You sense their drift zone: green\./, 'the old flat, lowercase concatenation is gone');
    // meta payload: byte-identical shape to before the wording change —
    // bot-manager and the dossier both read these fields directly.
    assert.deepEqual(Object.keys(result.meta).sort(), ['effectiveTier', 'factionHint', 'intelKind', 'target', 'tier', 'zone'].sort());
    assert.equal(result.meta.intelKind, 'interrogate');
    assert.equal(result.meta.tier, 2);
    assert.equal(result.meta.effectiveTier, 2);
    assert.equal(result.meta.target, target.player_code);
    assert.equal(result.meta.zone, 'green');
    assert.equal(result.meta.factionHint, 'heretic');
  } finally { f.close(); }
});

// ── §3a/§3b: per-actor "what you did last night" reports ──────────────────

test('night report: Chirurgeon protect — "Last night you protected X.", filed under X, own_action-flagged', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const chirurgeon = f.manager.players(f.code).find(p => p.role_id === 'chirurgeon');
    const target = f.manager.players(f.code).find(p => p.player_code !== chirurgeon.player_code);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    const g = f.manager.game(f.code);
    const expected = `Last night you protected ${f.manager.displayName(g, target)}.`;
    const msg = privMsgs(f, chirurgeon.player_code).find(m => m.body === expected);
    assert.ok(msg, 'report line present, exact wording');
    const filed = f.manager.listNotes(f.code, chirurgeon.player_code).bookmarks.find(b => b.messageId === msg.id);
    assert.ok(filed, 'auto-filed');
    assert.equal(filed.subjectCode, target.player_code, 'filed under the target');
    assert.equal(filed.ownAction, 1, 'flagged as the owner\'s own action, for a "my actions" view');
  } finally { f.close(); }
});

test('night report: Saboteur boobytrap is reported even on a night the trap catches nothing', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const saboteur = f.manager.players(f.code).find(p => p.role_id === 'saboteur');
    const target = f.manager.players(f.code).find(p => p.player_code !== saboteur.player_code);
    f.manager.submitAction(f.code, saboteur.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    const g = f.manager.game(f.code);
    const msgs = privMsgs(f, saboteur.player_code);
    assert.ok(msgs.some(m => m.body === `Last night you set a trap for ${f.manager.displayName(g, target)}.`), 'trap-setting is reported even with no catch');
    assert.ok(!msgs.some(m => /trap caught/i.test(m.body)), 'no catch happened, so no catch-intel message this round');
  } finally { f.close(); }
});

test('night report: "you moved against X" is worded identically whether the kill lands, is blocked, or is gated', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const murderer = f.manager.players(f.code).find(p => p.role_id === 'murderer');
    const chirurgeon = f.manager.players(f.code).find(p => p.role_id === 'chirurgeon');
    const target = f.manager.players(f.code).find(p => p.faction === 'loyalist' && p.role_id !== 'chirurgeon' && p.player_code !== murderer.player_code);
    const g = f.manager.game(f.code);
    const expected = `Last night you moved against ${f.manager.displayName(g, target)}.`;

    // Round 1: gated (drift 15 + kill cost 15 > max 20) — no kill, narrative cue instead.
    f.manager.db.prepare('UPDATE hr_players SET drift=15 WHERE game_code=? AND player_code=?').run(f.code, murderer.player_code);
    f.manager.submitAction(f.code, murderer.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    assert.ok(privMsgs(f, murderer.player_code).some(m => m.body === expected), 'gated kill still reports the choice');
    assert.equal(f.manager.player(f.code, target.player_code).alive, 1);

    // Round 2: blocked by Chirurgeon protect — target survives, no death message.
    f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);
    f.manager.db.prepare('UPDATE hr_players SET drift=0 WHERE game_code=? AND player_code=?').run(f.code, murderer.player_code);
    f.manager.submitAction(f.code, chirurgeon.player_code, { targetCode: target.player_code });
    f.manager.submitAction(f.code, murderer.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    assert.ok(privMsgs(f, murderer.player_code).some(m => m.body === expected), 'blocked kill still reports the choice, SAME wording');
    assert.equal(f.manager.player(f.code, target.player_code).alive, 1);

    // Round 3: unblocked — the kill actually lands.
    f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);
    f.manager.db.prepare('UPDATE hr_players SET drift=0 WHERE game_code=? AND player_code=?').run(f.code, murderer.player_code);
    f.manager.submitAction(f.code, murderer.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    assert.ok(privMsgs(f, murderer.player_code).some(m => m.body === expected), 'landed kill still reports the choice, SAME wording');
    assert.equal(f.manager.player(f.code, target.player_code).alive, 0, 'precondition: this round the kill actually landed');
  } finally { f.close(); }
});

test('night report: corrupt-sermon (Warp Litany) reports identical wording whether it lands or fizzles below the drift gate — no probe surface', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const players = f.manager.players(f.code);
    let priest = players.find(p => p.role_id === 'heretic-priest');
    if (!priest) {
      const p = players.find(x => x.faction === 'heretic');
      f.manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run('heretic-priest', 'heretic', f.code, p.player_code);
      priest = f.manager.players(f.code).find(x => x.role_id === 'heretic-priest');
    }
    const target = f.manager.players(f.code).find(p => p.player_code !== priest.player_code);
    const g = f.manager.game(f.code);
    const expected = `Last night you preached to ${f.manager.displayName(g, target)}.`;

    // skip_next_night=1 on the target freezes their drift for the gate check —
    // otherwise the generic "no action of their own -> sleep, -1 drift" pass
    // (which runs BEFORE the sermon loop, for every player who isn't the
    // ACTOR of their own action this round) would nudge the drift we just set
    // down by one before the gate ever reads it. Matches the existing Warp
    // Litany gate tests' own setup (game.test.js).

    // Round 1: target below the Orange (10) gate — Warp Litany fizzles silently.
    f.manager.db.prepare('UPDATE hr_players SET drift=0,skip_next_night=1 WHERE game_code=? AND player_code=?').run(f.code, target.player_code);
    f.manager.submitAction(f.code, priest.player_code, { targetCode: target.player_code, variant: 'warp-litany' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, target.player_code).drift, 0, 'precondition: fizzled, target untouched');
    assert.ok(privMsgs(f, priest.player_code).some(m => m.body === expected), 'fizzled litany still reports the choice');

    // Round 2: target at/above the gate — Warp Litany actually connects.
    f.manager.db.prepare("UPDATE hr_games SET phase='night' WHERE code=?").run(f.code);
    f.manager.db.prepare('UPDATE hr_players SET drift=10,skip_next_night=1 WHERE game_code=? AND player_code=?').run(f.code, target.player_code);
    f.manager.submitAction(f.code, priest.player_code, { targetCode: target.player_code, variant: 'warp-litany' });
    f.manager.resolve(f.code, true);
    assert.equal(f.manager.player(f.code, target.player_code).drift, 20, 'precondition: this time it landed (capped at max)');
    assert.ok(privMsgs(f, priest.player_code).some(m => m.body === expected), 'landed litany reports the SAME wording as the fizzle');
  } finally { f.close(); }
});

test('night report: an actor who submits no night action gets "You slept", stamped as their own choice', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    // Nobody submits anything this round — every living player falls into the
    // "no action" branch, regardless of role.
    const sleeper = f.manager.players(f.code)[0];
    f.manager.resolve(f.code, true);
    const msgs = privMsgs(f, sleeper.player_code);
    const sleepMsg = msgs.find(m => /^You slept\./.test(m.body));
    assert.ok(sleepMsg, 'sleep is reported');
    const filed = f.manager.listNotes(f.code, sleeper.player_code).bookmarks.find(b => b.messageId === sleepMsg.id);
    assert.ok(filed, 'auto-filed');
    assert.equal(filed.subjectCode, null, 'no target — General bucket');
    assert.equal(filed.ownAction, 1);
  } finally { f.close(); }
});

test('night report: a player force-skipped (skip_next_night) gets NO sleep report — they did not choose to rest', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const skipped = f.manager.players(f.code)[0];
    f.manager.db.prepare('UPDATE hr_players SET skip_next_night=1 WHERE game_code=? AND player_code=?').run(f.code, skipped.player_code);
    f.manager.resolve(f.code, true);
    const msgs = privMsgs(f, skipped.player_code);
    assert.ok(!msgs.some(m => /slept/i.test(m.body)), 'a forced skip is not narrated as a chosen sleep');
  } finally { f.close(); }
});

test('night report: possess already carries its own actor message and is not double-reported', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const candidate = f.manager.players(f.code).find(p => p.faction === 'heretic' && p.role_id !== 'murderer');
    f.manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run('animus', 'heretic', f.code, candidate.player_code);
    const animus = f.manager.player(f.code, candidate.player_code);
    const target = f.manager.players(f.code).find(p => p.player_code !== animus.player_code && p.faction !== 'heretic');
    f.manager.db.prepare('UPDATE hr_players SET drift=16 WHERE game_code=? AND player_code=?').run(f.code, target.player_code);
    f.manager.submitAction(f.code, animus.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    const msgs = privMsgs(f, animus.player_code);
    assert.ok(!msgs.some(m => /Last night you moved against|Last night you preached/.test(m.body)), 'no generic report duplicating the possess-specific one');
    assert.ok(msgs.some(m => /Neverborn|Warp/.test(m.body)), 'the possess-specific message is still the one delivered');
  } finally { f.close(); }
});

// ── §3a/§3c: own_action column semantics and the independent auto cap ─────

test('own_action: interrogate/drift-hint results are flagged as the actor\'s own action too', () => {
  const f = fixture(8);
  try {
    f.manager.start(f.code, 'p0'); f.manager.advance(f.code, 'p0');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    const filed = f.manager.listNotes(f.code, interrogator.player_code).bookmarks.find(b => b.subjectCode === target.player_code);
    assert.ok(filed);
    assert.equal(filed.ownAction, 1, 'a scan is the actor\'s own choice, same as a night-action report');
  } finally { f.close(); }
});

test('own_action: something done TO a player (no meta.target) is never flagged as their own action', () => {
  const f = fixture(5);
  try {
    f.manager.start(f.code, 'p0');
    const msg = f.manager.privateSystem(f.code, 'p1', 'Something struck at you in the dark. Someone else took the blow meant for you.');
    const filed = f.manager.listNotes(f.code, 'p1').bookmarks.find(b => b.messageId === msg.id);
    assert.ok(filed);
    assert.equal(filed.ownAction, 0);
    assert.equal(filed.subjectCode, null);
  } finally { f.close(); }
});

test('bookmark cap: auto-filed and manual entries have INDEPENDENT budgets — filling one does not block the other', () => {
  const f = fixture(5);
  try {
    for (let i = 0; i < 300; i++) {
      const m = f.manager.system(f.code, `Manual fill ${i}.`);
      f.manager.toggleBookmark(f.code, 'p0', m.id);
    }
    assert.throws(() => {
      const m = f.manager.system(f.code, 'One too many manual.');
      f.manager.toggleBookmark(f.code, 'p0', m.id);
    }, /limit/, 'manual cap still enforced at 300');
    const auto = f.manager.privateSystem(f.code, 'p0', 'An auto-filed line.', { target: 'p1' });
    const filed = f.manager.listNotes(f.code, 'p0').bookmarks.find(b => b.messageId === auto.id);
    assert.ok(filed, 'auto-filing still works even though the MANUAL bucket is full — separate budgets');
    assert.equal(filed.auto, 1);
  } finally { f.close(); }
});

test('bookmark cap: hitting the auto budget is logged (detectable), not a silent drop, and does not block manual saves', () => {
  const f = fixture(5);
  try {
    for (let i = 0; i < 300; i++) f.manager.privateSystem(f.code, 'p0', `Auto fill ${i}.`, { target: 'p1' });
    const before = f.manager.db.prepare("SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND auto=1").get(f.code, 'p0').n;
    assert.equal(before, 300);
    const overflow = f.manager.privateSystem(f.code, 'p0', 'One too many auto.', { target: 'p1' });
    const after = f.manager.db.prepare("SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND auto=1").get(f.code, 'p0').n;
    assert.equal(after, 300, 'the over-cap auto entry was not written');
    const event = f.manager.db.prepare("SELECT payload FROM hr_events WHERE game_code=? AND type='bookmark-cap-hit' ORDER BY id DESC LIMIT 1").get(f.code);
    assert.ok(event, 'the drop is logged via event(), not silent — the caller (night resolution) never throws on this');
    const payload = JSON.parse(event.payload);
    assert.equal(payload.ownerCode, 'p0');
    assert.equal(payload.scope, 'auto');
    const manual = f.manager.toggleBookmark(f.code, 'p0', overflow.id);
    assert.ok(manual, 'the message that failed to auto-file can still be saved by hand — separate budget');
    assert.equal(manual.auto, 0);
  } finally { f.close(); }
});

// ── §4: auto-filed bookmarks are pushed live to the owner, never broadcast ─

test('bookmark emit: autoBookmark fires onBookmark for the owner only, with the full bookmark row', () => {
  const f = fixture(5);
  try {
    const events = [];
    f.manager.onBookmark((code, ownerCode, bookmark) => events.push({ code, ownerCode, bookmark }));
    const msg = f.manager.privateSystem(f.code, 'p1', 'A private hint, just for you.', { target: 'p2' });
    assert.equal(events.length, 1, 'exactly one emit for one new auto-filed bookmark');
    assert.equal(events[0].code, f.code);
    assert.equal(events[0].ownerCode, 'p1', 'targeted at the recipient, never p0/p2/anyone else');
    assert.equal(events[0].bookmark.messageId, msg.id);
    assert.equal(events[0].bookmark.subjectCode, 'p2');
    assert.equal(events[0].bookmark.auto, 1);
  } finally { f.close(); }
});

test('bookmark emit: does not fire when autoBookmark is a no-op (duplicate, or the explicit role-reveal exemption)', () => {
  const f = fixture(5);
  try {
    const events = [];
    f.manager.start(f.code, 'p0');
    f.manager.onBookmark((code, ownerCode, bookmark) => events.push({ ownerCode, bookmark }));
    // Role-reveal passes {autoBookmark:false} — confirmed exemption stays in place.
    assert.equal(events.length, 0, 'no emit for the opening role-reveal');
    const msg = f.manager.privateSystem(f.code, 'p1', 'Your scan reads Red.', { intelKind: 'interrogate', target: 'p2' });
    assert.equal(events.length, 1);
    // Re-filing the exact same message is a no-op in autoBookmark and must not re-emit.
    f.manager.autoBookmark(f.code, 'p1', msg, { target: 'p2' });
    assert.equal(events.length, 1, 'idempotent — no duplicate emit for the same message');
  } finally { f.close(); }
});
