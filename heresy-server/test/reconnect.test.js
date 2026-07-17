import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-reconnect-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({
    databasePath: path.join(dir, 'game.db'),
    now: () => now,
    random: () => 0.9,
  });
  const { code } = manager.create({ playerCode: 'p-host-001', name: 'Host' });
  manager.join({ code, playerCode: 'p-guest-001', name: 'Guest' });
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('reconnect marks an existing player as connected', () => {
  const f = fixture();
  try {
    f.manager.disconnect('p-host-001');
    const before = f.manager.players(f.code).find(p => p.player_code === 'p-host-001');
    assert.equal(before.connected, 0);
    f.manager.reconnect(f.code, 'p-host-001');
    const after = f.manager.players(f.code).find(p => p.player_code === 'p-host-001');
    assert.equal(after.connected, 1);
  } finally { f.close(); }
});

test('reconnect refuses unknown players', () => {
  const f = fixture();
  try {
    assert.throws(() => f.manager.reconnect(f.code, 'p-ghost-999'), /Not a member/);
  } finally { f.close(); }
});

test('reconnect returns up-to-date state for the viewer', () => {
  const f = fixture();
  try {
    f.manager.disconnect('p-host-001');
    const state = f.manager.reconnect(f.code, 'p-host-001');
    assert.equal(state.code, f.code);
    assert.ok(Array.isArray(state.players));
    assert.equal(state.players.find(p => p.playerCode === 'p-host-001').connected, true);
  } finally { f.close(); }
});