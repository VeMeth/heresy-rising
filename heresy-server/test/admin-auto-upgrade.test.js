// Regression coverage for the "no dedicated admin entry point" design: a
// recognized admin identity silently gets the full adminState() view from
// game:spectate/game:state instead of the redacted spectate() one, rather
// than needing a separate game:admin-observe event. Covered against the
// real server + a real socket.io-client (see spectate-multiroom.test.js for
// why this needs the real socket layer, not just the in-process manager) —
// this also exercises the identity-peek in game:spectate that deliberately
// avoids calling auth() for a non-admin, since auth() mutates
// socket.data.playerCode and would wrongly pull a genuine anonymous
// spectator out of the isSpectator branch every broadcast() check relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const { createHeresyServer } = await import('../src/index.js');

// createHeresyServer only takes {databasePath, now} — adminPlayerCodes is
// read from the env-backed config module at import time, with no way to
// inject it per-instance. Tests that need an admin identity set
// srv.gameManager.adminPlayerCodes directly after construction instead;
// isAdmin() just reads that property live, so this works fine.
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-admin-upgrade-'));
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
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, auth: {} });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function connectAs(url, playerCode) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, auth: { playerCode } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('game:spectate upgrades a recognized admin identity to adminState(), even in the lobby', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const { code } = srv.gameManager.create({ playerCode: 'HOST-1', name: 'Host' });

    const socket = await connectAs(srv.url, 'HR-ADMIN00000001');
    try {
      const res = await emitAck(socket, 'game:spectate', { code });
      assert.equal(res.ok, true);
      assert.equal(res.state.isAdminObserver, true, 'admin identity gets adminState(), not the redacted spectate() view');
      assert.equal(res.state.phase, 'lobby', 'works even for a lobby-phase game, which plain spectate() rejects outright');
      assert.ok(Array.isArray(res.state.allMessages), 'adminState-specific field present');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('game:spectate still gives a non-admin the normal redacted spectator view, unaffected', async () => {
  const srv = await startServer();
  try {
    const { code } = srv.gameManager.create({ playerCode: 'HOST-1', name: 'Host' });
    for (let i = 1; i < 5; i++) { srv.gameManager.join({ code, playerCode: `P${i}`, name: `P${i}` }); srv.gameManager.ready(code, `P${i}`, true); }
    srv.gameManager.ready(code, 'HOST-1', true);
    srv.gameManager.start(code, 'HOST-1');

    const socket = await connectAs(srv.url, 'PLAIN-VISITOR-1');
    try {
      const res = await emitAck(socket, 'game:spectate', { code });
      assert.equal(res.ok, true);
      assert.equal(res.state.isSpectator, true);
      assert.equal(res.state.isAdminObserver, undefined, 'must never appear for a non-admin');
      assert.equal('allMessages' in res.state, false, 'admin-only field must not leak to a plain spectator');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('game:spectate with no handshake identity at all falls back to an anonymous spectator, not a crash', async () => {
  const srv = await startServer();
  try {
    const { code } = srv.gameManager.create({ playerCode: 'HOST-1', name: 'Host' });
    for (let i = 1; i < 5; i++) { srv.gameManager.join({ code, playerCode: `P${i}`, name: `P${i}` }); srv.gameManager.ready(code, `P${i}`, true); }
    srv.gameManager.ready(code, 'HOST-1', true);
    srv.gameManager.start(code, 'HOST-1');

    const socket = await connect(srv.url); // no auth.playerCode at all
    try {
      const res = await emitAck(socket, 'game:spectate', { code });
      assert.equal(res.ok, true);
      assert.equal(res.state.isSpectator, true);
      assert.ok(res.playerCode?.startsWith('spec_'), 'gets a throwaway spectator tag, same as before');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('game:state reconnect path upgrades a seatless admin identity too, fixing the post-refresh reconnect gap', async () => {
  const srv = await startServer();
  try {
    srv.gameManager.adminPlayerCodes = new Set(['HR-ADMIN00000001']);
    const { code } = srv.gameManager.create({ playerCode: 'HOST-1', name: 'Host' });

    const socket = await connectAs(srv.url, 'HR-ADMIN00000001');
    try {
      // Simulates a fresh page load / reload: game:state is exactly what
      // App.vue's onConnect() calls to restore a session, and this admin
      // identity has no hr_players row in this game at all.
      const res = await emitAck(socket, 'game:state', { code });
      assert.equal(res.ok, true);
      assert.equal(res.state.isAdminObserver, true);
      assert.equal(res.state.phase, 'lobby');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});
