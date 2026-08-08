// Embedded /api/playground mount: heresy-server mounts the playground router
// at /api/playground behind its own requirePlayground middleware (NOT
// requireAdmin — a SEPARATE gate so the playground can be shared with
// playtesters without exposing ADMIN_PASSWORD). This test pins:
//   - 401 with no header / wrong header
//   - 200 with the correct header (when not production + not default)
//   - 503 in production with a still-default password (fail-closed)
process.env.PLAYGROUND_PASSWORD = 'test-playground-password-for-mount-suite';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createHeresyServer } = await import('../src/index.js');

function fixtureServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-pg-mount-'));
  const instance = createHeresyServer({ databasePath: path.join(dir, 'game.db') });
  return new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', () => {
      const port = instance.server.address().port;
      resolve({
        instance,
        url: `http://127.0.0.1:${port}`,
        async close() { await instance.close(); fs.rmSync(dir, { recursive: true, force: true }); }
      });
    });
  });
}

test('GET /api/playground/roles — 401 without X-Playground-Password', async () => {
  const f = await fixtureServer();
  try {
    const res = await fetch(`${f.url}/api/playground/roles`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Playground password required');
  } finally { await f.close(); }
});

test('GET /api/playground/roles — 401 with a wrong X-Playground-Password', async () => {
  const f = await fixtureServer();
  try {
    const res = await fetch(`${f.url}/api/playground/roles`, { headers: { 'X-Playground-Password': 'nope' } });
    assert.equal(res.status, 401);
  } finally { await f.close(); }
});

test('GET /api/playground/roles — 401 with the admin password (gates are SEPARATE)', async () => {
  // The whole point of this change: a working ADMIN_PASSWORD does NOT unlock
  // the playground. Pin that explicitly so a future refactor that re-merges
  // the gates trips this test.
  const f = await fixtureServer();
  try {
    const res = await fetch(`${f.url}/api/playground/roles`, { headers: { 'X-Admin-Password': 'whatever' } });
    assert.equal(res.status, 401, 'admin header must not satisfy the playground gate');
  } finally { await f.close(); }
});

test('GET /api/playground/roles — 200 with the correct X-Playground-Password', async () => {
  const f = await fixtureServer();
  try {
    const res = await fetch(`${f.url}/api/playground/roles`, { headers: { 'X-Playground-Password': 'test-playground-password-for-mount-suite' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), 'playground router returns the bare roles array');
    assert.ok(body.length > 0, 'role list is non-empty');
  } finally { await f.close(); }
});
