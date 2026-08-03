import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { config as baseConfig } from '../src/config.js';
import { SessionStore } from '../src/sessionStore.js';
import { healthHandler } from '../src/health.js';
import { registerRestRoutes } from '../src/rest.js';
import { recordThought, readThoughts, _resetThoughtsForTests } from '../src/thoughts.js';

// --- unit tests: src/thoughts.js directly ---------------------------------

test.beforeEach(() => {
  _resetThoughtsForTests();
});

test('recordThought: assigns monotonic seq and ts, returns the stored entry', () => {
  const a = recordThought({ kind: 'action', summary: 'did a thing' });
  const b = recordThought({ kind: 'action', summary: 'did another thing' });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.ok(Number.isFinite(a.ts));
  assert.ok(b.ts >= a.ts);
  assert.equal(a.summary, 'did a thing');
});

test('recordThought: unrecognized kind is dropped (returns null, not stored)', () => {
  const r = recordThought({ kind: 'not-a-real-kind', summary: 'x' });
  assert.equal(r, null);
  const { entries } = readThoughts();
  assert.equal(entries.length, 0);
});

test('recordThought: never throws on malformed input', () => {
  assert.doesNotThrow(() => recordThought(null));
  assert.doesNotThrow(() => recordThought(undefined));
  assert.doesNotThrow(() => recordThought('a string, not an object'));
  assert.doesNotThrow(() => recordThought(42));
  assert.doesNotThrow(() => recordThought([]));
  assert.doesNotThrow(() => recordThought({})); // missing kind/summary entirely
  assert.doesNotThrow(() => recordThought({ kind: 'thinking' })); // missing summary

  // Circular object in detail — JSON.stringify would throw on this if it
  // leaked through unsanitized.
  const circular = { kind: 'thinking', summary: 'circular', detail: {} };
  circular.detail.self = circular.detail;
  assert.doesNotThrow(() => recordThought(circular));

  // A circular object as the top-level entry itself.
  const selfCircular = { kind: 'thinking', summary: 'self' };
  selfCircular.loop = selfCircular;
  assert.doesNotThrow(() => recordThought(selfCircular));

  // A 1MB string in `thought` and in `detail.text` — must be truncated, not
  // rejected outright, and must never throw doing so.
  const big = 'x'.repeat(1024 * 1024);
  let stored;
  assert.doesNotThrow(() => { stored = recordThought({ kind: 'thinking', summary: 'big', thought: big, detail: { text: big } }); });
  assert.ok(stored);
  assert.ok(stored.thought.length <= 2000);
  assert.ok(stored.detail.text.length <= 500);
});

test('caps: thought truncated to 2000 chars, detail.text truncated to 500 chars', () => {
  const stored = recordThought({
    kind: 'thinking',
    summary: 's',
    thought: 'a'.repeat(3000),
    detail: { text: 'b'.repeat(1000) }
  });
  assert.equal(stored.thought.length, 2000);
  assert.equal(stored.detail.text.length, 500);
});

test('caps: buffer bounded at 500 entries; 10,000 recorded leaves <=500 retained', () => {
  for (let i = 0; i < 10000; i++) {
    recordThought({ kind: 'action', summary: `entry-${i}` });
  }
  const { entries, latestSeq } = readThoughts({ limit: 500 });
  assert.ok(entries.length <= 500);
  assert.equal(entries.length, 500);
  assert.equal(latestSeq, 10000);
  // Oldest retained entry should be #9500 (0-indexed), i.e. seq 9501, since
  // the first 9500 were evicted.
  assert.equal(entries[0].summary, 'entry-9500');
  assert.equal(entries[entries.length - 1].summary, 'entry-9999');
});

test('seq stays monotonic across eviction (never reused)', () => {
  for (let i = 0; i < 600; i++) recordThought({ kind: 'action', summary: `e${i}` });
  const { entries } = readThoughts({ limit: 500 });
  assert.equal(entries.length, 500);
  // seqs should be strictly increasing and match 101..600 (first 100 evicted).
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i].seq > entries[i - 1].seq);
  }
  assert.equal(entries[0].seq, 101);
  assert.equal(entries[entries.length - 1].seq, 600);
});

test('readThoughts: since=<seq> returns only newer entries; empty when no new activity', () => {
  recordThought({ kind: 'action', summary: 'one' });
  const afterOne = recordThought({ kind: 'action', summary: 'two' });
  let { entries } = readThoughts({ since: 0 });
  assert.equal(entries.length, 2);

  ({ entries } = readThoughts({ since: afterOne.seq }));
  assert.equal(entries.length, 0);

  recordThought({ kind: 'action', summary: 'three' });
  ({ entries } = readThoughts({ since: afterOne.seq }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].summary, 'three');
});

test('readThoughts: oldest-first ordering', () => {
  recordThought({ kind: 'action', summary: 'first' });
  recordThought({ kind: 'action', summary: 'second' });
  recordThought({ kind: 'action', summary: 'third' });
  const { entries } = readThoughts();
  assert.deepEqual(entries.map((e) => e.summary), ['first', 'second', 'third']);
});

test('readThoughts: filters by conclaveCode', () => {
  recordThought({ kind: 'action', summary: 'a', conclaveCode: 'ABC123' });
  recordThought({ kind: 'action', summary: 'b', conclaveCode: 'XYZ789' });
  recordThought({ kind: 'action', summary: 'c', conclaveCode: 'ABC123' });
  const { entries } = readThoughts({ conclaveCode: 'ABC123' });
  assert.deepEqual(entries.map((e) => e.summary), ['a', 'c']);
});

test('readThoughts: filters by botId', () => {
  recordThought({ kind: 'action', summary: 'a', botId: 'BOT-1' });
  recordThought({ kind: 'action', summary: 'b', botId: 'BOT-2' });
  const { entries } = readThoughts({ botId: 'BOT-1' });
  assert.deepEqual(entries.map((e) => e.summary), ['a']);
});

test('readThoughts: filters by kinds (array, multiple allowed)', () => {
  recordThought({ kind: 'thinking', summary: 'a' });
  recordThought({ kind: 'action', summary: 'b' });
  recordThought({ kind: 'rejected', summary: 'c' });
  recordThought({ kind: 'error', summary: 'd' });
  const { entries } = readThoughts({ kinds: ['action', 'rejected'] });
  assert.deepEqual(entries.map((e) => e.summary), ['b', 'c']);
});

test('readThoughts: filtering happens before limit is applied', () => {
  // 3 matching entries interleaved with 3 non-matching; limit=2 should return
  // the first 2 MATCHING entries, not the first 2 of the raw buffer.
  recordThought({ kind: 'action', summary: 'match-1', botId: 'B' });
  recordThought({ kind: 'action', summary: 'noise-1', botId: 'OTHER' });
  recordThought({ kind: 'action', summary: 'match-2', botId: 'B' });
  recordThought({ kind: 'action', summary: 'noise-2', botId: 'OTHER' });
  recordThought({ kind: 'action', summary: 'match-3', botId: 'B' });
  const { entries, dropped } = readThoughts({ botId: 'B', limit: 2 });
  assert.deepEqual(entries.map((e) => e.summary), ['match-1', 'match-2']);
  assert.equal(dropped, true);
});

test('readThoughts: dropped is false when everything matching fit under limit', () => {
  recordThought({ kind: 'action', summary: 'a' });
  recordThought({ kind: 'action', summary: 'b' });
  const { dropped } = readThoughts({ limit: 200 });
  assert.equal(dropped, false);
});

test('recordThought: detail fields pass through and are sanitized', () => {
  const stored = recordThought({
    kind: 'thinking',
    summary: 'reasoning captured',
    thought: 'I suspect P-03 is a Heretic',
    detail: { verb: 'vote', target: 'P-03', tokens: 128, latencyMs: 450, finishReason: 'stop', attempt: 1 }
  });
  assert.equal(stored.detail.verb, 'vote');
  assert.equal(stored.detail.target, 'P-03');
  assert.equal(stored.detail.tokens, 128);
  assert.equal(stored.detail.latencyMs, 450);
  assert.equal(stored.detail.attempt, 1);
});

// --- REST layer: GET /thoughts ---------------------------------------------

function boot({ adminKey = 'admin-secret', simKey = 'sim-secret', botKey = 'bot-secret' } = {}) {
  const config = { ...baseConfig, adminApiKey: adminKey, simBypassToken: simKey, botApiKey: botKey };
  const app = express(); app.disable('x-powered-by'); app.use(express.json());
  const sessionStore = new SessionStore();
  app.set('sessionStore', sessionStore); app.set('config', config);
  app.get('/health', healthHandler);
  const engineClient = {
    async spawn() { return { playerCode: 'HR-BOT-x', seat: 0, isBot: true, name: 'Bot', conclaveCode: 'X' }; },
    async despawn() { return { despawned: true }; }
  };
  app.set('engineClient', engineClient);
  registerRestRoutes(app, sessionStore, engineClient, config);
  return new Promise((resolve) => { const server = app.listen(0, () => resolve({ server, sessionStore, config })); });
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

test('GET /thoughts: unauthenticated request is rejected', async () => {
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/thoughts');
    assert.equal(r.status, 403);
  } finally { server.close(); }
});

test('GET /thoughts: authed request succeeds and returns the expected shape', async () => {
  _resetThoughtsForTests();
  recordThought({ kind: 'action', summary: 'test entry', conclaveCode: 'CONCL1', botId: 'B1' });
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/thoughts', { token: 'admin-secret' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
    assert.ok(r.body.entries.length >= 1);
    assert.ok(Number.isFinite(r.body.latestSeq));
    assert.equal(typeof r.body.dropped, 'boolean');
  } finally { server.close(); }
});

test('GET /thoughts: SIM_BYPASS_TOKEN also authorizes', async () => {
  _resetThoughtsForTests();
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/thoughts', { token: 'sim-secret' });
    assert.equal(r.status, 200);
  } finally { server.close(); }
});

test('GET /thoughts: since param filters to only newer entries', async () => {
  _resetThoughtsForTests();
  const first = recordThought({ kind: 'action', summary: 'first' });
  const { server } = await boot(); try {
    recordThought({ kind: 'action', summary: 'second' });
    const r = await req(server, 'GET', `/thoughts?since=${first.seq}`, { token: 'admin-secret' });
    assert.equal(r.status, 200);
    assert.equal(r.body.entries.length, 1);
    assert.equal(r.body.entries[0].summary, 'second');

    // Polling again with no new activity returns an empty array, not the whole buffer.
    const r2 = await req(server, 'GET', `/thoughts?since=${r.body.latestSeq}`, { token: 'admin-secret' });
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.body.entries, []);
  } finally { server.close(); }
});

test('GET /thoughts: conclave, bot, and kinds query params filter results', async () => {
  _resetThoughtsForTests();
  recordThought({ kind: 'thinking', summary: 'a', conclaveCode: 'AAA111', botId: 'B1' });
  recordThought({ kind: 'action', summary: 'b', conclaveCode: 'BBB222', botId: 'B2' });
  recordThought({ kind: 'error', summary: 'c', conclaveCode: 'AAA111', botId: 'B2' });
  const { server } = await boot(); try {
    const byConclave = await req(server, 'GET', '/thoughts?conclave=AAA111', { token: 'admin-secret' });
    assert.deepEqual(byConclave.body.entries.map((e) => e.summary), ['a', 'c']);

    const byBot = await req(server, 'GET', '/thoughts?bot=B2', { token: 'admin-secret' });
    assert.deepEqual(byBot.body.entries.map((e) => e.summary), ['b', 'c']);

    const byKinds = await req(server, 'GET', '/thoughts?kinds=thinking,error', { token: 'admin-secret' });
    assert.deepEqual(byKinds.body.entries.map((e) => e.summary), ['a', 'c']);
  } finally { server.close(); }
});

test('GET /thoughts: limit param is clamped to a sane maximum', async () => {
  _resetThoughtsForTests();
  for (let i = 0; i < 50; i++) recordThought({ kind: 'action', summary: `e${i}` });
  const { server } = await boot(); try {
    const r = await req(server, 'GET', '/thoughts?limit=999999', { token: 'admin-secret' });
    assert.equal(r.status, 200);
    assert.ok(r.body.entries.length <= 500);
  } finally { server.close(); }
});
