import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

function fixture(count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-kick-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({
    databasePath: path.join(dir, 'game.db'),
    now: () => now,
    random: () => 0.9,
  });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) manager.join({ code, playerCode: `p${i}`, name: `P${i}` });
  return { manager, code, close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('kick removes a non-host player from the lobby', () => {
  const f = fixture(6);
  try {
    const before = f.manager.players(f.code).length;
    const state = f.manager.kick(f.code, 'p0', 'p1');
    assert.equal(state.players.length, before - 1);
    assert.equal(state.players.some(p => p.playerCode === 'p1'), false);
    assert.equal(state.players.some(p => p.playerCode === 'p0'), true, 'host remains');
  } finally { f.close(); }
});

test('kick only the host can kick', () => {
  const f = fixture(5);
  try {
    assert.throws(() => f.manager.kick(f.code, 'p1', 'p2'), /Host permission required/);
    assert.throws(() => f.manager.kick(f.code, 'ghost', 'p2'), /Host permission required/);
  } finally { f.close(); }
});

test('host cannot kick themselves', () => {
  const f = fixture(5);
  try {
    assert.throws(() => f.manager.kick(f.code, 'p0', 'p0'), /cannot kick themselves/);
  } finally { f.close(); }
});

test('kick is rejected after the game has started', () => {
  const f = fixture(5);
  try {
    for (let i = 1; i < 5; i++) f.manager.ready(f.code, `p${i}`, true);
    f.manager.start(f.code, 'p0');
    assert.throws(() => f.manager.kick(f.code, 'p0', 'p1'), /lobby/);
  } finally { f.close(); }
});

test('kick rejects unknown targets', () => {
  const f = fixture(5);
  try {
    assert.throws(() => f.manager.kick(f.code, 'p0', 'nobody'), /Not a member/);
  } finally { f.close(); }
});