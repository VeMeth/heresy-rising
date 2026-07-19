import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { config as baseConfig } from '../src/config.js';
import { SessionStore } from '../src/sessionStore.js';
import { EngineClient } from '../src/engineClient.js';
import { healthHandler } from '../src/health.js';
import { registerRestRoutes } from '../src/rest.js';

function boot({ adminKey='admin-secret', simKey='sim-secret', botKey='bot-secret' } = {}) {
  const config = { ...baseConfig, adminApiKey:adminKey, simBypassToken:simKey, botApiKey:botKey };
  const app = express(); app.disable('x-powered-by'); app.use(express.json());
  const sessionStore = new SessionStore();
  app.set('sessionStore', sessionStore); app.set('config', config);
  app.get('/health', healthHandler);
  // A mock engine client that fakes spawn/despawn to avoid needing a live heresy-server.
  const engineClient = {
    async spawn({ conclaveCode, name, seatHint }) {
      return { playerCode: 'HR-BOT-' + Math.random().toString(16).slice(2, 10) + 'deadbeef', seat: 0, isBot: true, name: name || 'Bot', conclaveCode };
    },
    async despawn({ conclaveCode, playerCode }) { return { despawned: true, playerCode, conclaveCode }; }
  };
  app.set('engineClient', engineClient);
  registerRestRoutes(app, sessionStore, engineClient, config);
  return new Promise(resolve => { const server = app.listen(0, () => resolve({ server, sessionStore, config })); });
}

async function req(server, method, path, { token, body } = {}) {
  const port = server.address().port;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, body: json };
}

test('admin-gate: missing bearer token → 403', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'POST', '/bots', { body: { conclaveCode: 'ABCD12' } });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Bearer token required/);
  } finally { server.close(); }
});

test('admin-gate: unknown token → 403', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'POST', '/bots', { token: 'wrong', body: { conclaveCode: 'ABCD12' } });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Unknown or missing token/);
  } finally { server.close(); }
});

test('admin-gate: ADMIN_API_KEY works', async () => {
  const { server } = await boot({ adminKey: 'admin-secret' }); try {
    const r = await req(server, 'GET', '/bots', { token: 'admin-secret' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  } finally { server.close(); }
});

test('admin-gate: SIM_BYPASS_TOKEN also works (sim/test harness path)', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/bots', { token: 'sim-secret' });
    assert.equal(r.status, 200);
  } finally { server.close(); }
});

test('/health is open (no auth)', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.sessions, 0);
    assert.ok(r.body.uptime >= 0);
  } finally { server.close(); }
});

test('POST /bots with a missing conclaveCode → 400', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'POST', '/bots', { token: 'admin-secret', body: {} });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /conclaveCode/);
  } finally { server.close(); }
});

test('POST /bots spawn → returns botId == playerCode; GET /bots/:id inspects; DELETE removes', async () => {
  const { server, sessionStore } = await boot(); try {
    const spawn = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'CONCL1', name: 'Cogitator-1' } });
    assert.equal(spawn.status, 200);
    assert.ok(spawn.body.botId && spawn.body.botId.startsWith('HR-BOT-'));
    assert.equal(spawn.body.botId, spawn.body.playerCode);
    assert.equal(spawn.body.conclaveCode, 'CONCL1');

    const list = await req(server, 'GET', '/bots', { token: 'admin-secret' });
    assert.equal(list.body.length, 1);

    const inspect = await req(server, 'GET', `/bots/${spawn.body.botId}`, { token: 'admin-secret' });
    assert.equal(inspect.status, 200);
    assert.equal(inspect.body.botId, spawn.body.botId);
    assert.equal(inspect.body.conclaveCode, 'CONCL1');
    assert.equal(inspect.body.role, null); // still lobby
    assert.equal(inspect.body.lastAction, 'init');

    const del = await req(server, 'DELETE', `/bots/${spawn.body.botId}`, { token: 'admin-secret' });
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);
    assert.equal(sessionStore.count(), 0);
  } finally { server.close(); }
});

test('GET /bots/:id for unknown id → 404', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/bots/HR-BOT-nope', { token: 'admin-secret' });
    assert.equal(r.status, 404);
  } finally { server.close(); }
});

test('POST /bots/:id/notes sets a note; GET reads it back', async () => {
  const { server } = await boot(); try {
    const spawn = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'CONCL1' } });
    const r = await req(server, 'POST', `/bots/${spawn.body.botId}/notes`, { token: 'admin-secret', body: { key: 'P-02-suspicion', value: 'Voted with Heretics on Day 2' } });
    assert.equal(r.status, 200);
    const read = await req(server, 'GET', `/bots/${spawn.body.botId}/notes`, { token: 'admin-secret' });
    assert.equal(read.status, 200);
    assert.equal(read.body['P-02-suspicion'], 'Voted with Heretics on Day 2');
  } finally { server.close(); }
});

test('notes: missing key → 400', async () => {
  const { server } = await boot(); try {
    const spawn = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'CONCL1' } });
    const r = await req(server, 'POST', `/bots/${spawn.body.botId}/notes`, { token: 'admin-secret', body: { value: 'no key' } });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('MAX_BOTS_PER_GAME enforced — fifth spawn is rejected and previous reservation rolled back', async () => {
  const { server, sessionStore } = await boot({ adminKey: 'admin-secret' });
  // Reduce the cap for the test by setting it on the config after boot.
  server.appconfig = server.appconfig || {};
  try {
    // Override bespoke: spawn 4 OK, 5th fails with 409.
    for (let i = 0; i < 4; i++) {
      const r = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'SAME', name: `B${i}` } });
      assert.equal(r.status, 200, `spawn #${i} should succeed`);
    }
    const fifth = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'SAME', name: 'B4' } });
    assert.equal(fifth.status, 409);
    assert.match(fifth.body.error, /MAX_BOTS_PER_GAME/);
    // Remaining four active.
    const list = await req(server, 'GET', '/bots', { token: 'admin-secret' });
    assert.equal(list.body.length, 4);
    assert.equal(sessionStore.count(), 4);
  } finally { server.close(); }
});

test('MAX_BOT_SESSIONS enforced at the global level', async () => {
  const { server, sessionStore, config } = await boot({ adminKey: 'admin-secret' });
  // Force global cap to 2 for the test by direct config mutation; rest.js referenced closure over the same `config` object.
  config.maxBotSessions = 2;
  try {
    const r1 = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'A' } });
    assert.equal(r1.status, 200);
    const r2 = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'B' } });
    assert.equal(r2.status, 200);
    const r3 = await req(server, 'POST', '/bots', { token: 'admin-secret', body: { conclaveCode: 'C' } });
    assert.equal(r3.status, 503);
    assert.match(r3.body.error, /MAX_BOT_SESSIONS/);
  } finally { server.close(); }
});