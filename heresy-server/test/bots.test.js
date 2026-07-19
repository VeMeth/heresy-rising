import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture(count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-bots-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => now, random: () => 0.9 });
  const { code } = manager.create({ playerCode: 'host-human-1', name: 'Host' });
  for (let i = 1; i < count; i++) { manager.join({ code, playerCode: `human-${i}`, name: `H${i}` }); manager.ready(code, `human-${i}`, true); }
  return { manager, code, dir, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('adminSpawnBot: adds a bot player marked is_bot=1 in the lobby', () => {
  const f = fixture(5); try {
    const r = f.manager.adminSpawnBot(f.code, { name: 'Cogitator-1', seatHint: null });
    assert.ok(r.playerCode.startsWith('HR-BOT-'), 'engine issues a bot-prefixed player code');
    assert.equal(r.isBot, true);
    assert.equal(r.conclaveCode, f.code);
    const bot = f.manager.player(f.code, r.playerCode);
    assert.equal(bot.is_bot, 1);
    assert.equal(bot.ready, 1, 'bots spawn pre-ready');
    assert.equal(bot.name, 'Cogitator-1');
    assert.ok(bot.seat >= 0 && bot.seat < 12);
  } finally { f.close(); }
});

test('adminSpawnBot: refuses spawn after the game has started', () => {
  const f = fixture(5); try {
    f.manager.start(f.code, 'host-human-1');
    assert.throws(() => f.manager.adminSpawnBot(f.code), /lobby/);
  } finally { f.close(); }
});

test('adminSpawnBot: respects MAX_BOTS_PER_GAME (default 4) per conclave', () => {
  const f = fixture(5); try {
    for (let i = 0; i < 4; i++) f.manager.adminSpawnBot(f.code, { name: `B${i}` });
    assert.throws(() => f.manager.adminSpawnBot(f.code), /Bot limit/);
  } finally { f.close(); }
});

test('adminSpawnBot: refuses when conclave is full at 12 players', () => {
  const f = fixture(11); try {
    f.manager.adminSpawnBot(f.code); // 12th seat (11 humans + 1 bot)
    assert.equal(f.manager.players(f.code).length, 12);
    assert.throws(() => f.manager.adminSpawnBot(f.code), /full/);
  } finally { f.close(); }
});

test('adminSpawnBot: honours explicit seatHint, rejects taken seat or out-of-range', () => {
  const f = fixture(5); try {
    const r = f.manager.adminSpawnBot(f.code, { seatHint: 5 });
    assert.equal(r.seat, 5);
    assert.throws(() => f.manager.adminSpawnBot(f.code, { seatHint: 5 }), /taken/);
    assert.throws(() => f.manager.adminSpawnBot(f.code, { seatHint: 12 }), /taken|out of range/);
    assert.throws(() => f.manager.adminSpawnBot(f.code, { seatHint: 0 }), /taken/); // host at seat 0
  } finally { f.close(); }
});

test('adminDespawnBot: removes a bot only while in the lobby', () => {
  const f = fixture(5); try {
    const r = f.manager.adminSpawnBot(f.code, { name: 'B' });
    const out = f.manager.adminDespawnBot(f.code, r.playerCode);
    assert.equal(out.despawned, true);
    assert.equal(f.manager.player(f.code, r.playerCode), undefined);
  } finally { f.close(); }
});

test('adminDespawnBot: refuses to despawn a non-bot player (safety guard)', () => {
  const f = fixture(5); try {
    assert.throws(() => f.manager.adminDespawnBot(f.code, 'human-1'), /Not a bot/);
    const r = f.manager.adminSpawnBot(f.code);
    f.manager.start(f.code, 'host-human-1');
    assert.throws(() => f.manager.adminDespawnBot(f.code, r.playerCode), /lobby/);
  } finally { f.close(); }
});

test('botIds: returns the player codes of every bot in the conclave', () => {
  const f = fixture(5); try {
    const b1 = f.manager.adminSpawnBot(f.code);
    const b2 = f.manager.adminSpawnBot(f.code, { seatHint: 6 });
    assert.deepEqual(f.manager.botIds(f.code).sort(), [b1.playerCode, b2.playerCode].sort());
  } finally { f.close(); }
});

test('botSessionInit: returns role=null while still in the lobby, populated after start', () => {
  const f = fixture(5); try {
    const bot = f.manager.adminSpawnBot(f.code);
    const lobbyInit = f.manager.botSessionInit(f.code, bot.playerCode);
    assert.equal(lobbyInit.role, null);
    assert.equal(lobbyInit.faction, null);
    assert.equal(lobbyInit.phase, 'lobby');
    assert.deepEqual(lobbyInit.botIds, [bot.playerCode]);
    assert.ok(lobbyInit.alivePlayers.includes(bot.playerCode));
    f.manager.start(f.code, 'host-human-1');
    const startedInit = f.manager.botSessionInit(f.code, bot.playerCode);
    assert.ok(startedInit.role, 'role populated after start');
    assert.ok(['loyalist', 'heretic'].includes(startedInit.faction));
    assert.equal(startedInit.phase, 'day');
    assert.equal(startedInit.round, 1);
    assert.equal(startedInit.votingEnabled, false, 'Day 1 votingEnabled=false per Q28');
    assert.deepEqual(startedInit.botIds, [bot.playerCode]);
  } finally { f.close(); }
});

test('botSessionInit: returns null for non-bot players', () => {
  const f = fixture(5); try {
    assert.equal(f.manager.botSessionInit(f.code, 'human-1'), null);
  } finally { f.close(); }
});

test('drift-blind contract: state() never exposes numeric drift to any viewer (incl. bots)', () => {
  const f = fixture(5); try {
    const bot = f.manager.adminSpawnBot(f.code);
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1'); // to night
    const ps = f.manager.players(f.code);
    f.manager.db.prepare('UPDATE hr_players SET drift=12 WHERE game_code=? AND player_code=?').run(f.code, ps[0].player_code);
    const state = f.manager.state(f.code, bot.playerCode);
    const json = JSON.stringify(state);
    assert.ok(!json.includes('"drift"'), 'bot state payload must not contain the word "drift"');
    const isHereticBot = state.me.faction === 'heretic';
    const others = state.players.filter(p => p.playerCode !== bot.playerCode);
    others.forEach(p => {
      // Every viewer (bots included) never sees another player's role.
      assert.equal(p.role, undefined, 'other players\' roles are never exposed');
      // Heretic viewers see other Heretics' faction — that's the locked v1
      // heretic-sees-heretic rule. Anything else stays undefined.
      if (isHereticBot && p.faction === 'heretic') return;
      assert.equal(p.faction, undefined, 'non-Heretic faction visibility is hidden from bots');
    });
  } finally { f.close(); }
});

test('structured intel meta: interrogator private intel return carries meta.intelKind', () => {
  const f = fixture(5); try {
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    const target = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code && p.faction === 'loyalist');
    f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T1' });
    f.manager.resolve(f.code, true);
    const msgs = f.manager.db.prepare("SELECT body,meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id").all(f.code, interrogator.player_code)
      .map(m => ({ body: m.body, meta: m.meta ? JSON.parse(m.meta) : null }));
    const intel = msgs.find(m => m.meta?.intelKind === 'interrogate');
    assert.ok(intel, 'an interrogate intel_return was emitted with structured meta');
    assert.equal(intel.meta.tier, 1);
    assert.equal(intel.meta.target, target.player_code);
    assert.ok(['clean', 'tainted'].includes(intel.meta.result));
    assert.ok(intel.meta.zone, 'zone exposed to the acting bot per spec (own intel)');
  } finally { f.close(); }
});

test('structured intel meta: novice-psychic result carries zone-bounded drift-hint meta', () => {
  const f = fixture(8); try {
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1');
    // Force L4 on one player (matches the existing game-test pattern).
    const players = f.manager.players(f.code);
    const l4 = players[6], target = players[7];
    f.manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run('novice-psychic', 'loyalist', f.code, l4.player_code);
    f.manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run('imperial-citizen', 'loyalist', f.code, target.player_code);
    f.manager.submitAction(f.code, l4.player_code, { targetCode: target.player_code });
    f.manager.resolve(f.code, true);
    const msgs = f.manager.db.prepare("SELECT meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=?").all(f.code, l4.player_code)
      .map(m => m.meta ? JSON.parse(m.meta) : null);
    const hint = msgs.find(m => m?.intelKind === 'drift-hint');
    assert.ok(hint, 'drift-hint meta emitted');
    assert.equal(hint.action, 'scan_drift');
    assert.equal(hint.target, target.player_code);
    assert.ok(['green', 'yellow', 'orange', 'red', 'black'].includes(hint.zone));
  } finally { f.close(); }
});

test('drift-zone change drops a private hint meta with ownZone for the player whose drift moved', () => {
  const f = fixture(5); try {
    f.manager.start(f.code, 'host-human-1');
    const p = f.manager.players(f.code)[0];
    f.manager.db.prepare('UPDATE hr_players SET drift=4 WHERE game_code=? AND player_code=?').run(f.code, p.player_code);
    f.manager.changeDrift(f.code, p.player_code, 2, 'test');
    const last = f.manager.db.prepare("SELECT meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=? ORDER BY id DESC LIMIT 1").get(f.code, p.player_code);
    const meta = last.meta ? JSON.parse(last.meta) : null;
    assert.equal(meta?.intelKind, 'drift_hint');
    assert.equal(meta?.ownZone, 'yellow');
  } finally { f.close(); }
});

test('execute-on-sight: interrogator private intel meta says execute_on_sight + reveals faction', () => {
  const f = fixture(8); try {
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1');
    const interrogator = f.manager.players(f.code).find(p => p.role_id === 'interrogator');
    // Force a heretic target into Orange (12) so T2 triggers Execute-on-Sight.
    const target = f.manager.players(f.code).find(p => p.faction === 'heretic' && p.player_code !== interrogator.player_code);
    if (!target) {
      // Composition may not include interrogator+heretic here under our random; fall back to forcing roles.
      const forced = f.manager.players(f.code).find(p => p.player_code !== interrogator.player_code);
      f.manager.db.prepare('UPDATE hr_players SET role_id=?,faction=? WHERE game_code=? AND player_code=?').run('murderer', 'heretic', f.code, forced.player_code);
      f.manager.db.prepare('UPDATE hr_players SET drift=12 WHERE game_code=? AND player_code=?').run(f.code, forced.player_code);
      f.manager.submitAction(f.code, interrogator.player_code, { targetCode: forced.player_code, variant: 'T2' });
      f.manager.resolve(f.code, true);
      const msgs = f.manager.db.prepare("SELECT meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=?").all(f.code, interrogator.player_code).map(m => m.meta ? JSON.parse(m.meta) : null);
      const ex = msgs.find(m => m?.intelKind === 'execute_on_sight');
      assert.ok(ex, 'execute-on-sight intel_return meta emitted to the interrogator');
      assert.equal(ex.target, forced.player_code);
      assert.equal(ex.faction, 'heretic');
      assert.equal(f.manager.player(f.code, forced.player_code).alive, 0);
    } else {
      f.manager.db.prepare('UPDATE hr_players SET drift=12 WHERE game_code=? AND player_code=?').run(f.code, target.player_code);
      f.manager.submitAction(f.code, interrogator.player_code, { targetCode: target.player_code, variant: 'T2' });
      f.manager.resolve(f.code, true);
      const msgs = f.manager.db.prepare("SELECT meta FROM hr_messages WHERE game_code=? AND channel='private' AND recipient_code=?").all(f.code, interrogator.player_code).map(m => m.meta ? JSON.parse(m.meta) : null);
      const ex = msgs.find(m => m?.intelKind === 'execute_on_sight');
      assert.ok(ex, 'execute-on-sight intel_return meta emitted to the interrogator');
      assert.equal(ex.target, target.player_code);
      assert.equal(ex.faction, target.faction);
      assert.equal(f.manager.player(f.code, target.player_code).alive, 0);
    }
  } finally { f.close(); }
});

test('bot prompts: setPhase emits night_action_prompt and day_vote_prompt for bot seats', () => {
  const f = fixture(5); try {
    const events = [];
    f.manager.onBotPrompt((code, payload) => events.push(payload));
    const bot = f.manager.adminSpawnBot(f.code);
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1'); // Day 1 -> Night 1: fires night_action_prompt
    const nightPrompt = events.find(e => e.kind === 'night_action_prompt' && e.playerCode === bot.playerCode);
    assert.ok(nightPrompt, 'night_action_prompt fired for the bot when phase became night');
    f.manager.advance(f.code, 'host-human-1'); // Night 1 -> Day 2: fires day_vote_prompt
    const day2 = events.find(e => e.kind === 'day_vote_prompt' && e.playerCode === bot.playerCode);
    assert.ok(day2, 'Day 2 fires a day_vote_prompt for the bot');
    assert.equal(day2.votingEnabled, true);
    assert.ok(Array.isArray(day2.legalTargets));
    assert.ok(day2.legalTargets.includes('host-human-1'));
  } finally { f.close(); }
});

test('bot prompts: Day 1 emits NO day_vote_prompt (Q28)', () => {
  const f = fixture(5); try {
    const events = [];
    f.manager.onBotPrompt((code, payload) => events.push(payload));
    const bot = f.manager.adminSpawnBot(f.code);
    f.manager.start(f.code, 'host-human-1');
    f.manager.advance(f.code, 'host-human-1');
    const dayVote = events.find(e => e.kind === 'day_vote_prompt');
    assert.equal(dayVote, undefined, 'no day_vote_prompt before Day 2');
  } finally { f.close(); }
});

test('adminPlayer: exposes isBot flag so the admin UI can badge bot seats', () => {
  const f = fixture(5); try {
    const bot = f.manager.adminSpawnBot(f.code);
    f.manager.start(f.code, 'host-human-1');
    const g = f.manager.game(f.code);
    const adminBot = f.manager.adminPlayer(f.manager.player(f.code, bot.playerCode), g);
    const adminHuman = f.manager.adminPlayer(f.manager.player(f.code, 'host-human-1'), g);
    assert.equal(adminBot.isBot, true);
    assert.equal(adminHuman.isBot, false);
  } finally { f.close(); }
});

test('multiple bots: two bots know about each other via botIds', () => {
  const f = fixture(6); try {
    const b1 = f.manager.adminSpawnBot(f.code); // auto seat (free)
    const b2 = f.manager.adminSpawnBot(f.code, { seatHint: 7 });
    f.manager.start(f.code, 'host-human-1');
    const ids1 = f.manager.botSessionInit(f.code, b1.playerCode).botIds.sort();
    const ids2 = f.manager.botSessionInit(f.code, b2.playerCode).botIds.sort();
    assert.deepEqual(ids1, [b1.playerCode, b2.playerCode].sort());
    assert.deepEqual(ids2, [b1.playerCode, b2.playerCode].sort());
  } finally { f.close(); }
});