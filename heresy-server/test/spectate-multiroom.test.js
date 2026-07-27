// Regression coverage for a real bug the conclave switcher exposed: spectator
// status used to live on socket.data.isSpectator, a single boolean for the
// whole connection, set once by game:spectate and never cleared. A socket
// that spectated ANY game would then be treated as a spectator of EVERY
// room it was in — including a different game where it's a real, seated
// player — because broadcast()/broadcastMessage()/game:state all trusted
// that one flag regardless of which room they were actually handling.
// Switching between games in one session (spectate an ended game, then jump
// to an active one you're actually in) makes this the common case, not an
// edge case, so it's covered here against the real server + a real
// socket.io-client, not just the in-process manager.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const { createHeresyServer } = await import('../src/index.js');

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-multiroom-'));
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

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

test('a socket that spectates one game is still treated as a real member of a different game it has an actual seat in', async () => {
  const srv = await startServer();
  try {
    // Game A: this player is a real, seated member.
    const { code: codeA } = srv.gameManager.create({ playerCode: 'PLAYER-A', name: 'Sabine' });
    for (let i = 1; i < 5; i++) { srv.gameManager.join({ code: codeA, playerCode: `A-P${i}`, name: `AP${i}` }); srv.gameManager.ready(codeA, `A-P${i}`, true); }
    srv.gameManager.ready(codeA, 'PLAYER-A', true);
    srv.gameManager.start(codeA, 'PLAYER-A');

    // Game B: an unrelated game this player has NO seat in, but is allowed to spectate (must be started).
    const { code: codeB } = srv.gameManager.create({ playerCode: 'OTHER-HOST', name: 'Host' });
    for (let i = 1; i < 5; i++) { srv.gameManager.join({ code: codeB, playerCode: `B-P${i}`, name: `BP${i}` }); srv.gameManager.ready(codeB, `B-P${i}`, true); }
    srv.gameManager.ready(codeB, 'OTHER-HOST', true);
    srv.gameManager.start(codeB, 'OTHER-HOST');

    const socket = await connect(srv.url);
    try {
      // Spectate game B first — this is what used to poison the socket's
      // global isSpectator flag for every room afterward.
      const specRes = await emitAck(socket, 'game:spectate', { code: codeB, playerCode: 'PLAYER-A' });
      assert.equal(specRes.ok, true);
      assert.equal(specRes.state.isSpectator, true);

      // Now fetch state for game A, where this playerCode is a REAL seated
      // member. Before the fix this incorrectly returned a spectate() view
      // (no `me`, no role) because of the stale connection-wide flag.
      const stateRes = await emitAck(socket, 'game:state', { code: codeA, playerCode: 'PLAYER-A' });
      assert.equal(stateRes.ok, true);
      assert.ok(!stateRes.state.isSpectator, 'must be treated as a real player of A, not a spectator');
      assert.ok(stateRes.state.me, 'a real member always gets a `me` entry');
      assert.equal(stateRes.state.me.playerCode, 'PLAYER-A');
      assert.ok(stateRes.state.me.role, 'a real member sees their own role, which spectate() never includes');

      // Exercise the real chat path end-to-end: PLAYER-A sends a public
      // message in A while this same socket is still "contaminated" by
      // having spectated B, and confirms delivery — proving
      // broadcastMessage() no longer treats this socket as a spectator of A.
      const nextMessage = waitFor(socket, 'chat:message');
      const sendRes = await emitAck(socket, 'chat:send', { code: codeA, channel: 'public', body: 'Hello from a real member', playerCode: 'PLAYER-A' });
      assert.equal(sendRes.ok, true);
      const delivered = await nextMessage;
      assert.equal(delivered.message.body, 'Hello from a real member');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});
