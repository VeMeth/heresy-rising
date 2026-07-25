import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimServer } from '../src/server.js';

// createSimServer() reads env-derived config (SIM_BYPASS_TOKEN,
// SIM_HARD_MAX_GAMES, SIM_MAX_WORKERS) at REQUEST time inside the route
// handler, not at app-creation time — so each test can freely set
// process.env before making its request. node:test runs top-level tests in
// a file sequentially by default, so this is safe without extra locking.

function boot() {
  const app = createSimServer();
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function req(server, method, path, { token, body } = {}) {
  const port = server.address().port;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token !== undefined) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, body: json };
}

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(vars)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    }
  })();
}

test('GET /health is open (no auth) and returns {ok:true}', async () => {
  const server = await boot();
  try {
    const r = await req(server, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  } finally { server.close(); }
});

test('POST /simulate: SIM_BYPASS_TOKEN unset -> 503, never silently accepts', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: undefined }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'anything',
        body: { composition: { source: 'preset', presetId: '5p' }, games: 3 },
      });
      assert.equal(r.status, 503);
      assert.match(r.body.error, /not configured/);
    } finally { server.close(); }
  });
});

test('POST /simulate: missing bearer token -> 401', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        body: { composition: { source: 'preset', presetId: '5p' }, games: 3 },
      });
      assert.equal(r.status, 401);
    } finally { server.close(); }
  });
});

test('POST /simulate: wrong bearer token -> 401', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'wrong-token',
        body: { composition: { source: 'preset', presetId: '5p' }, games: 3 },
      });
      assert.equal(r.status, 401);
    } finally { server.close(); }
  });
});

test('POST /simulate: missing composition -> 400', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', { token: 'secret-token', body: { games: 3 } });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /composition/);
    } finally { server.close(); }
  });
});

test('POST /simulate: invalid composition (unknown role, no heretic) -> 400 with validator details', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        body: { composition: { source: 'custom', roster: ['not-a-real-role', 'imperial-citizen'] }, games: 3 },
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'Invalid composition');
      assert.ok(Array.isArray(r.body.details));
      assert.ok(r.body.details.some(e => e.rule === 'H3'));
    } finally { server.close(); }
  });
});

test('POST /simulate: games <= 0 -> 400', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        body: { composition: { source: 'preset', presetId: '5p' }, games: 0 },
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /positive integer/);
    } finally { server.close(); }
  });
});

test('POST /simulate: succeeds with a small real batch and returns the documented shape', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token', SIM_MAX_WORKERS: '1' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        body: { composition: { source: 'preset', presetId: '5p' }, games: 3, seed: 12345 },
      });
      assert.equal(r.status, 200);
      const { meta, summary, perRole, games, perComposition } = r.body;
      assert.equal(meta.gameCount, 3);
      assert.equal(meta.playerCount, 5);
      assert.equal(meta.seed, 12345);
      assert.equal(summary.totalGames, 3);
      assert.ok(typeof perRole === 'object');
      assert.equal(games.length, 3);
      assert.ok(games[0].composition.length === 5);
      assert.ok(typeof perComposition === 'object');
      assert.ok(Object.keys(perComposition).length >= 1);
    } finally { server.close(); }
  });
});

test('POST /simulate: games is clamped to SIM_HARD_MAX_GAMES regardless of the request', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token', SIM_HARD_MAX_GAMES: '4', SIM_MAX_WORKERS: '2' }, async () => {
    const server = await boot();
    try {
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        // Ask for far more than the test's low cap — must never actually run 1000.
        body: { composition: { source: 'preset', presetId: '5p' }, games: 1000 },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.meta.gameCount, 4);
    } finally { server.close(); }
  });
});

test('POST /simulate: worker count is capped by SIM_MAX_WORKERS regardless of host core count', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token', SIM_MAX_WORKERS: '2' }, async () => {
    const server = await boot();
    try {
      // 8 games with a cap of 2 workers clears the runBatchParallel
      // sequential-fallback threshold (games >= workers*2), so meta.workers
      // is actually populated by the parallel path.
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        body: { composition: { source: 'preset', presetId: '5p' }, games: 8 },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.meta.workers, 2);
    } finally { server.close(); }
  });
});

test('POST /simulate: a batch that fails entirely returns 500 with a real error, never a fake empty 200', async () => {
  await withEnv({ SIM_BYPASS_TOKEN: 'secret-token', SIM_MAX_WORKERS: '1' }, async () => {
    const server = await boot();
    try {
      // This custom roster passes validateComposition (1 heretic <= 2
      // loyalists, no soft-rule roles) but has only 3 players — below the
      // engine's 5-12 floor, enforced inside HeresyGameManager.start()
      // itself rather than by validateComposition. Every simulated game
      // throws, reproducing the historical zero-games bug's exact failure
      // shape (see heresy-sim/sim-results/*.json).
      const r = await req(server, 'POST', '/simulate', {
        token: 'secret-token',
        body: {
          composition: { source: 'custom', roster: ['murderer', 'imperial-citizen', 'imperial-citizen'] },
          games: 3,
        },
      });
      assert.equal(r.status, 500);
      assert.ok(r.body.error && r.body.error.length > 0);
      assert.match(r.body.error, /5.12 players/);
    } finally { server.close(); }
  });
});
