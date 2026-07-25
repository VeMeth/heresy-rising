// Env vars must be set BEFORE config.js is ever evaluated — config.js reads
// process.env at module-evaluation time and caches the result. Every other
// test file in this repo imports HeresyGameManager directly and never
// touches src/index.js/config.js, so (per node's default one-process-per-
// test-file isolation, confirmed empirically) nothing else in the suite
// observes these. createHeresyServer/config are pulled in via a dynamic
// import below, after these are set, rather than a static import (which
// would evaluate before this file's own top-level statements run).
process.env.SIM_BYPASS_TOKEN = 'test-sim-bypass-token';
process.env.SIM_HOST_COOLDOWN_MS = '150';
process.env.SIM_MAX_GAMES_HOST = '50';
process.env.SIM_MAX_GAMES_ADMIN = '200';
process.env.SIM_FETCH_TIMEOUT_MS = '5000';
process.env.ADMIN_PASSWORD = 'test-admin-password-for-simulate-suite';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';

const { createHeresyServer } = await import('../src/index.js');
const { config } = await import('../src/config.js');

// ── Fake heresy-sim ──────────────────────────────────────────────────────
// Mirrors bot-manager/test/fakeOpenAI.js's approach: a tiny local HTTP
// server standing in for the real service, pointed to via HERESY_SIM_URL.
function startFakeSim() {
  let responder = (payload) => ({
    status: 200,
    body: {
      meta: { simVersion: '1.0.0', timestamp: new Date().toISOString(), seed: payload.seed ?? null, playerCount: (payload.composition?.roster || []).length || 5, gameCount: payload.games, strategyMix: { heuristic: payload.games }, elapsed: 42 },
      summary: { loyalistWins: 6, hereticWins: 4, draws: 0, loyalistWinRate: 0.6, hereticWinRate: 0.4, drawRate: 0, avgRounds: 4.2, medianRounds: 4, totalGames: payload.games },
      perRole: {},
      games: [],
      perComposition: {}
    }
  });
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let payload; try { payload = JSON.parse(raw || '{}'); } catch { payload = {}; }
      received.push({ payload, authorization: req.headers['authorization'] || '' });
      const { status, body } = responder(payload);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        received,
        callCount: () => received.length,
        setResponder(fn) { responder = fn; },
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

// The fake sim's URL is fixed once per process (config.sim.url is read at
// dynamic-import time above), so it's started once and shared by every test
// in this file; each test resets its own expectations via setResponder.
const fakeSim = await startFakeSim();
process.env.HERESY_SIM_URL = fakeSim.baseUrl; // no effect post-import; config already resolved config.sim.url below via explicit override instead.

// config.sim.url was already frozen at import time (before fakeSim existed),
// so directly patch it for this suite — the exported `config` object is a
// plain mutable object, not re-evaluated per read.
config.sim.url = fakeSim.baseUrl;

test.after(async () => { await fakeSim.close(); });

function fixtureServer({ count = 5, now = () => Date.now() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-sim-route-'));
  const instance = createHeresyServer({ databasePath: path.join(dir, 'game.db'), now });
  const { code } = instance.gameManager.create({ playerCode: 'HOST-0000', name: 'Host' });
  for (let i = 1; i < count; i++) {
    instance.gameManager.join({ code, playerCode: `PLAYER-${i}00`, name: `P${i}` });
    instance.gameManager.ready(code, `PLAYER-${i}00`, true);
  }
  return new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', () => {
      const port = instance.server.address().port;
      resolve({
        instance,
        code,
        url: `http://127.0.0.1:${port}`,
        async close() { await instance.close(); fs.rmSync(dir, { recursive: true, force: true }); }
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

const preset5p = { source: 'preset', presetId: '5p' };
const preset6p = { source: 'preset', presetId: '6p' };

test('game:simulate — host can simulate their own lobby (happy path)', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 10 });
      assert.equal(ack.ok, true, JSON.stringify(ack));
      assert.equal(ack.result.summary.totalGames, 10);
      assert.equal(fakeSim.callCount(), 1);
      const call = fakeSim.received[0];
      assert.equal(call.authorization, `Bearer ${config.sim.bypassToken}`);
      assert.equal(call.payload.games, 10);
      assert.deepEqual(call.payload.composition, preset5p);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — non-host is rejected', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'PLAYER-100', composition: preset5p, games: 5 });
      assert.equal(ack.ok, false);
      assert.match(ack.error, /[Hh]ost/);
      assert.equal(fakeSim.callCount(), 0, 'heresy-sim must never be called for a rejected request');
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — wrong phase (already started) is rejected', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    f.instance.gameManager.start(f.code, 'HOST-0000');
    const socket = await connect(f.url);
    try {
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(ack.ok, false);
      assert.match(ack.error, /lobby/);
      assert.equal(fakeSim.callCount(), 0);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — re-submitting the EXACT same setup is blocked outright, even after the cooldown window passes', async () => {
  let now = 1_000_000;
  const f = await fixtureServer({ count: 5, now: () => now });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const first = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(first.ok, true);
      assert.equal(fakeSim.callCount(), 1);

      const second = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(second.ok, false);
      assert.match(second.error, /already simulated/i, 'a same-setup rejection is a distinct message from a cooldown rejection');
      assert.equal(fakeSim.callCount(), 1, 'a same-setup rejection must not reach heresy-sim');

      now += config.sim.hostCooldownMs + 10; // advance well past the cooldown window
      const third = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(third.ok, false, 'the SAME setup stays blocked regardless of elapsed time — only a changed setup clears it');
      assert.match(third.error, /already simulated/i);
      assert.equal(fakeSim.callCount(), 1);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — per-lobby cooldown still applies to a DIFFERENT setup requested too soon', async () => {
  let now = 1_000_000;
  const f = await fixtureServer({ count: 5, now: () => now });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const first = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(first.ok, true);
      assert.equal(fakeSim.callCount(), 1);

      const second = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset6p, games: 5 });
      assert.equal(second.ok, false, 'a different setup is not blocked outright, but still owes the standard cooldown');
      assert.match(second.error, /cooling down/i);
      assert.equal(fakeSim.callCount(), 1, 'a cooldown rejection must not reach heresy-sim');

      now += config.sim.hostCooldownMs + 10; // advance past the cooldown window
      const third = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset6p, games: 5 });
      assert.equal(third.ok, true, 'the different setup succeeds once the cooldown clears');
      assert.equal(fakeSim.callCount(), 2);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — a custom roster is "the same setup" as an equivalent roster in a different order', async () => {
  let now = 1_000_000;
  const f = await fixtureServer({ count: 5, now: () => now });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const rosterA = { source: 'custom', roster: ['murderer', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'] };
      const rosterAReordered = { source: 'custom', roster: ['imperial-citizen', 'chirurgeon', 'interrogator', 'priest', 'murderer'] };
      const first = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: rosterA, games: 5 });
      assert.equal(first.ok, true);
      const second = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: rosterAReordered, games: 5 });
      assert.equal(second.ok, false, 'same roles, different order — still the same setup');
      assert.match(second.error, /already simulated/i);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — games count is silently clamped to [1, SIM_MAX_GAMES_HOST]', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const tooMany = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 999999 });
      assert.equal(tooMany.ok, true);
      assert.equal(fakeSim.received[0].payload.games, config.sim.maxGamesHost);

      const tooFew = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 0 });
      // Cooldown from the first call above blocks this one deterministically —
      // that's fine, we only care that a request which DOES clear cooldown
      // clamps correctly; re-test the low bound on a second lobby instead.
      assert.equal(tooFew.ok, false);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — low games bound clamps to 1 (separate lobby, no cooldown interference)', async () => {
  const f = await fixtureServer({ count: 6 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: { source: 'preset', presetId: '6p' }, games: -5 });
      assert.equal(ack.ok, true);
      assert.equal(fakeSim.received.at(-1).payload.games, 1);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — invalid composition (unknown role) is rejected before ever reaching heresy-sim', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const bad = { source: 'custom', roster: ['not-a-real-role', 'priest', 'interrogator', 'chirurgeon', 'imperial-citizen'], confirmedWarnings: [] };
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: bad, games: 5 });
      assert.equal(ack.ok, false);
      assert.match(ack.error, /Invalid composition/);
      assert.equal(fakeSim.callCount(), 0);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — out-of-5-12-bounds composition is rejected before ever reaching heresy-sim', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const socket = await connect(f.url);
    try {
      const tooSmall = { source: 'custom', roster: ['murderer', 'priest', 'imperial-citizen'], confirmedWarnings: [] };
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: tooSmall, games: 5 });
      assert.equal(ack.ok, false);
      assert.match(ack.error, /between 5 and 12/);
      assert.equal(fakeSim.callCount(), 0);
    } finally { socket.close(); }
  } finally { await f.close(); }
});

test('game:simulate — a stub heresy-sim 500 propagates as a real error, not a fake success', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  fakeSim.setResponder(() => ({ status: 500, body: { error: 'batch genuinely failed: worker crashed' } }));
  try {
    const socket = await connect(f.url);
    try {
      const ack = await emitAck(socket, 'game:simulate', { code: f.code, playerCode: 'HOST-0000', composition: preset5p, games: 5 });
      assert.equal(ack.ok, false);
      assert.match(ack.error, /worker crashed/);
      assert.equal(fakeSim.callCount(), 1, 'heresy-sim WAS called — this is a genuine upstream failure, not a validation rejection');
    } finally { socket.close(); }
  } finally {
    fakeSim.setResponder((payload) => ({ status: 200, body: { meta: {}, summary: { totalGames: payload.games }, perRole: {}, games: [], perComposition: {} } }));
    await f.close();
  }
});

// ── POST /api/admin/simulate ────────────────────────────────────────────

test('POST /api/admin/simulate — requires X-Admin-Password', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const res = await fetch(`${f.url}/api/admin/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ composition: preset5p, games: 5 })
    });
    assert.equal(res.status, 401);
    assert.equal(fakeSim.callCount(), 0);

    const wrong = await fetch(`${f.url}/api/admin/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': 'nope' },
      body: JSON.stringify({ composition: preset5p, games: 5 })
    });
    assert.equal(wrong.status, 401);
    assert.equal(fakeSim.callCount(), 0);
  } finally { await f.close(); }
});

test('POST /api/admin/simulate — happy path proxies to heresy-sim and clamps to the (higher) admin cap', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const res = await fetch(`${f.url}/api/admin/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': config.adminPassword },
      body: JSON.stringify({ composition: preset5p, games: 999999 })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.summary.totalGames, config.sim.maxGamesAdmin);
    assert.equal(fakeSim.callCount(), 1);
    assert.equal(fakeSim.received[0].payload.games, config.sim.maxGamesAdmin);
    assert.ok(config.sim.maxGamesAdmin > config.sim.maxGamesHost, 'admin cap must exceed the host cap');
  } finally { await f.close(); }
});

test('POST /api/admin/simulate — invalid composition is rejected (400) before ever reaching heresy-sim', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  try {
    const bad = { source: 'custom', roster: ['not-a-real-role'], confirmedWarnings: [] };
    const res = await fetch(`${f.url}/api/admin/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': config.adminPassword },
      body: JSON.stringify({ composition: bad, games: 5 })
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'Invalid composition');
    assert.ok(Array.isArray(json.details));
    assert.equal(fakeSim.callCount(), 0);
  } finally { await f.close(); }
});

test('POST /api/admin/simulate — a stub heresy-sim 500 passes through untouched (proxy, not swallowed)', async () => {
  const f = await fixtureServer({ count: 5 });
  fakeSim.received.length = 0;
  fakeSim.setResponder(() => ({ status: 500, body: { error: 'admin batch failed: out of memory' } }));
  try {
    const res = await fetch(`${f.url}/api/admin/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': config.adminPassword },
      body: JSON.stringify({ composition: preset5p, games: 5 })
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.match(json.error, /out of memory/);
  } finally {
    fakeSim.setResponder((payload) => ({ status: 200, body: { meta: {}, summary: { totalGames: payload.games }, perRole: {}, games: [], perComposition: {} } }));
    await f.close();
  }
});
