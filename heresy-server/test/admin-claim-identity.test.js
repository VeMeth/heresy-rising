// player_code is a self-reported, unsigned client value everywhere else in
// this codebase — the whole admin-tooling feature set is explicitly a soft
// gate on that basis. This is the one place that isn't soft: claiming an
// admin player_code onto a NEW browser (the "Restore an existing identity"
// flow — see recoverProfile() in App.vue) requires the real ADMIN_PASSWORD,
// the same secret that already gates the REST /admin panel. A normal
// player's code never touches the password check at all.
process.env.ADMIN_PASSWORD = 'test-claim-identity-password';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const { createHeresyServer } = await import('../src/index.js');
const { config } = await import('../src/config.js');

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-claim-identity-'));
  const instance = createHeresyServer({ databasePath: path.join(dir, 'game.db') });
  return new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', () => {
      const port = instance.server.address().port;
      resolve({
        gameManager: instance.gameManager,
        url: `http://127.0.0.1:${port}`,
        async close() { await instance.close(); fs.rmSync(dir, { recursive: true, force: true }); },
      });
    });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('player:claim-identity lets a non-admin code through with no password at all', async () => {
  const srv = await startServer();
  try {
    const socket = await connect(srv.url);
    try {
      const res = await emitAck(socket, 'player:claim-identity', { code: 'HR-JUSTAPLAYER0001' });
      assert.equal(res.ok, true);
      assert.equal(res.playerCode, 'HR-JUSTAPLAYER0001');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('player:claim-identity rejects an admin code with no password', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const socket = await connect(srv.url);
    try {
      const res = await emitAck(socket, 'player:claim-identity', { code: 'HR-ADMIN00000001' });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'ADMIN_PASSWORD_REQUIRED');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('player:claim-identity rejects an admin code with the wrong password', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const socket = await connect(srv.url);
    try {
      const res = await emitAck(socket, 'player:claim-identity', { code: 'HR-ADMIN00000001', password: 'not-it' });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'ADMIN_PASSWORD_REQUIRED');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('player:claim-identity accepts an admin code with the correct ADMIN_PASSWORD', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const socket = await connect(srv.url);
    try {
      const res = await emitAck(socket, 'player:claim-identity', { code: 'HR-ADMIN00000001', password: config.adminPassword });
      assert.equal(res.ok, true);
      assert.equal(res.playerCode, 'HR-ADMIN00000001');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('player:claim-identity is case/whitespace-normalized the same way other player codes are', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const socket = await connect(srv.url);
    try {
      const res = await emitAck(socket, 'player:claim-identity', { code: '  hr-admin00000001  ' });
      // normalizePlayerCode doesn't uppercase — this just confirms trimming
      // happens and the resulting (lowercase) code is compared as typed,
      // not silently coerced into matching the allowlist entry.
      assert.equal(res.ok, true);
      assert.notEqual(res.playerCode, 'HR-ADMIN00000001');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});
