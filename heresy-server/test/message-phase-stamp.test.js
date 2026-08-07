// Coverage for the round/phase stamp added to hr_messages so the in-game
// chat-search feature can filter by day. Four touch points changed together
// (heresyGameManager.js): the ensureColumn migrations in the constructor,
// insertMessage's INSERT + re-SELECT, historyMessages's SELECT, and the
// allMessages/privateMessages SELECTs used by state()/adminState(). This
// file exercises the socket-facing path end to end (chat:history/chat:message)
// rather than the manager directly, so a regression in any one of those four
// spots — especially insertMessage's re-SELECT, which only ever shows up on
// the LIVE push, not on a later history fetch — actually fails a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const { createHeresyServer } = await import('../src/index.js');

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-msg-stamp-'));
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

// Seats 5 players (PLAYER-0 host, PLAYER-1..PLAYER-4) directly on the
// manager and seals roles — the same "start a 5p game" shape game.test.js's
// fixture() uses, minus the factory wrapper since this file only needs it
// once per test. Codes must be >=8 chars (requirePlayerCode, utils.js) since
// these are driven through real sockets, unlike game.test.js's manager-only
// 'p0'..'p4'. MIN_PLAYERS is 5 (game_data/rules.json) and FIRST_VOTING_ROUND
// is 2, so this lands on Day 1 (round 1, no vote) exactly like game.test.js's
// flows do.
function seatFiveAndStart(gameManager) {
  const { code } = gameManager.create({ playerCode: 'PLAYER-0', name: 'P0' });
  for (let i = 1; i < 5; i++) {
    gameManager.join({ code, playerCode: `PLAYER-${i}`, name: `P${i}` });
    gameManager.ready(code, `PLAYER-${i}`, true);
  }
  gameManager.start(code, 'PLAYER-0');
  return code;
}

test('chat:history stamps a player message sent during Day 2 with round 2 / phase day', async () => {
  const srv = await startServer();
  try {
    const code = seatFiveAndStart(srv.gameManager);
    srv.gameManager.advance(code, 'PLAYER-0'); // Day 1 -> Night 1
    srv.gameManager.advance(code, 'PLAYER-0'); // Night 1 -> Day 2
    assert.equal(srv.gameManager.game(code).phase, 'day');
    assert.equal(srv.gameManager.game(code).round, 2);

    const socket = await connect(srv.url);
    try {
      const sendRes = await emitAck(socket, 'chat:send', { code, channel: 'public', body: 'hello from day 2', playerCode: 'PLAYER-1' });
      assert.equal(sendRes.ok, true);

      const histRes = await emitAck(socket, 'chat:history', { code, channel: 'public', playerCode: 'PLAYER-1' });
      assert.equal(histRes.ok, true);
      const row = histRes.messages.find((m) => m.body === 'hello from day 2');
      assert.ok(row, 'the sent message must appear in chat:history');
      assert.equal(row.round, 2);
      assert.equal(row.phase, 'day');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('chat:message live push carries the stamp too (guards insertMessage\'s re-SELECT)', async () => {
  const srv = await startServer();
  try {
    const code = seatFiveAndStart(srv.gameManager);
    srv.gameManager.advance(code, 'PLAYER-0'); // Day 1 -> Night 1
    srv.gameManager.advance(code, 'PLAYER-0'); // Night 1 -> Day 2
    assert.equal(srv.gameManager.game(code).round, 2);

    const socket = await connect(srv.url);
    try {
      // A socket only receives room broadcasts once it has joined the room —
      // game:state is what does that (chat:history deliberately doesn't).
      await emitAck(socket, 'game:state', { code, playerCode: 'PLAYER-1' });

      const nextMessage = waitFor(socket, 'chat:message');
      const sendRes = await emitAck(socket, 'chat:send', { code, channel: 'public', body: 'live push check', playerCode: 'PLAYER-1' });
      assert.equal(sendRes.ok, true);
      const delivered = await nextMessage;

      assert.equal(delivered.message.body, 'live push check');
      // If insertMessage's re-SELECT ever drops round/phase from its column
      // list again, chat:history (a fresh SELECT) would still show the stamp
      // fine — only the object handed straight to broadcastMessage would come
      // back unstamped. That's what this asserts against.
      assert.notEqual(delivered.message.round, null, 'live push must not be unstamped');
      assert.notEqual(delivered.message.round, undefined, 'live push must not be unstamped');
      assert.notEqual(delivered.message.phase, null, 'live push must not be unstamped');
      assert.notEqual(delivered.message.phase, undefined, 'live push must not be unstamped');
      assert.equal(delivered.message.round, 2);
      assert.equal(delivered.message.phase, 'day');
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('a night-phase system line is stamped phase night with the round it happened in', async () => {
  const srv = await startServer();
  try {
    const code = seatFiveAndStart(srv.gameManager);
    srv.gameManager.advance(code, 'PLAYER-0'); // Day 1 -> Night 1
    assert.equal(srv.gameManager.game(code).phase, 'night');
    assert.equal(srv.gameManager.game(code).round, 1);

    // System lines are always engine-authored (see the "private is READ-ONLY
    // and engine-authored" comment on historyMessages) — there is no client
    // event a player can fire to author one, so this calls the manager
    // directly, exactly like the "a night-phase kill/execution posts a public
    // system line" call sites inside resolveNight() do.
    srv.gameManager.system(code, 'Something moves through the dark.');

    const socket = await connect(srv.url);
    try {
      const histRes = await emitAck(socket, 'chat:history', { code, channel: 'public', playerCode: 'PLAYER-1' });
      assert.equal(histRes.ok, true);
      const row = histRes.messages.find((m) => m.body === 'Something moves through the dark.');
      assert.ok(row, 'the night system line must appear in chat:history');
      assert.equal(row.phase, 'night');
      assert.equal(row.round, 1);
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('chat:history rows never carry player_code/recipient_code keys (no publicMessage() sanitization needed)', async () => {
  const srv = await startServer();
  try {
    const code = seatFiveAndStart(srv.gameManager);

    const socket = await connect(srv.url);
    try {
      const sendRes = await emitAck(socket, 'chat:send', { code, channel: 'public', body: 'leak check', playerCode: 'PLAYER-1' });
      assert.equal(sendRes.ok, true);

      const histRes = await emitAck(socket, 'chat:history', { code, channel: 'public', playerCode: 'PLAYER-1' });
      assert.equal(histRes.ok, true);
      assert.ok(histRes.messages.length > 0);
      for (const row of histRes.messages) {
        const keys = Object.keys(row);
        assert.ok(!keys.includes('player_code'), 'chat:history row must not carry player_code');
        assert.ok(!keys.includes('playerCode'), 'chat:history row must not carry playerCode');
        assert.ok(!keys.includes('recipient_code'), 'chat:history row must not carry recipient_code');
        assert.ok(!keys.includes('recipientCode'), 'chat:history row must not carry recipientCode');
      }
    } finally {
      socket.close();
    }
  } finally {
    await srv.close();
  }
});

test('private chat:history is self-scoped: player A never sees player B\'s private lines, and both are stamped', async () => {
  const srv = await startServer();
  try {
    const code = seatFiveAndStart(srv.gameManager);
    assert.equal(srv.gameManager.game(code).phase, 'day');
    assert.equal(srv.gameManager.game(code).round, 1);

    // Private lines are engine-authored only (privateSystem) — there is no
    // client-facing way to send one player-to-player.
    srv.gameManager.privateSystem(code, 'PLAYER-1', 'Secret for A only');
    srv.gameManager.privateSystem(code, 'PLAYER-2', 'Secret for B only');

    const socketA = await connect(srv.url);
    try {
      const histRes = await emitAck(socketA, 'chat:history', { code, channel: 'private', playerCode: 'PLAYER-1' });
      assert.equal(histRes.ok, true);

      const ownLine = histRes.messages.find((m) => m.body === 'Secret for A only');
      assert.ok(ownLine, 'player A must see their own private line');
      assert.equal(ownLine.round, 1);
      assert.equal(ownLine.phase, 'day');

      assert.ok(
        histRes.messages.every((m) => m.body !== 'Secret for B only'),
        'player A must never see player B\'s private line'
      );
    } finally {
      socketA.close();
    }
  } finally {
    await srv.close();
  }
});
