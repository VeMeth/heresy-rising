import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-msg-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => 1_000_000, random: () => 0.5 });
  const { code } = manager.create({ playerCode: 'host-1', name: 'Host' });
  manager.join({ code, playerCode: 'human-2', name: 'H2' });
  return { manager, code, dir, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// Regression test for the bot-manager rework's engine fix: insertMessage's
// re-SELECT previously omitted player_code/recipient_code, which broke a
// bot's own-message self-identification (session.js: `m.player_code ===
// this.playerCode`), silently disabled the echo-chamber guard, and left
// `private` channel chat:message delivery dead (index.js's broadcastMessage
// compares `message.recipient_code === client.data.playerCode`).
test('insertMessage: returns player_code and recipient_code on the row', () => {
  const f = fixture();
  try {
    const pub = f.manager.insertMessage(f.code, 'public', null, 'host-1', 'Host', 'hello table', 'player');
    assert.equal(pub.player_code, 'host-1');
    assert.equal(pub.recipient_code, null);

    const priv = f.manager.insertMessage(f.code, 'private', 'human-2', null, 'The Vox', 'a secret', 'system');
    assert.equal(priv.recipient_code, 'human-2');
    assert.equal(priv.player_code, null);
  } finally { f.close(); }
});

test('sendMessage: public chat row carries the sender player_code (bot self-identification input)', () => {
  const f = fixture();
  try {
    const m = f.manager.sendMessage(f.code, 'host-1', 'public', 'I am innocent');
    assert.equal(m.player_code, 'host-1');
  } finally { f.close(); }
});

test('system()/privateSystem(): rows carry player_code=null and the right recipient_code', () => {
  const f = fixture();
  try {
    const sys = f.manager.system(f.code, 'The conclave gathers.');
    assert.equal(sys.player_code, null);
    assert.equal(sys.recipient_code, null);
    const priv = f.manager.privateSystem(f.code, 'human-2', 'A private hint.');
    assert.equal(priv.recipient_code, 'human-2');
  } finally { f.close(); }
});
