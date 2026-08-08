// Standalone createApp() gate: when PLAYGROUND_PASSWORD is set in the env
// (and not the shipped default), every /api/* request must carry the
// matching X-Playground-Password header. With the env unset (or default),
// the gate is a no-op — preserves the historical "127.0.0.1-only, no auth"
// dev ergonomics (playground/server/index.js's file header).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../api.js';

const SHIPPED_DEFAULT = 'BD-playground-default-9c4f1230ab27e8b04f96a02e1d57cf46-change-me';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function get(url, headers = {}) {
  return fetch(url, { headers });
}

test('standalone createApp: with no PLAYGROUND_PASSWORD set, /api/roles is open (dev ergonomics preserved)', async () => {
  const prev = process.env.PLAYGROUND_PASSWORD;
  delete process.env.PLAYGROUND_PASSWORD;
  const app = createApp();
  const f = await listen(app);
  try {
    const res = await get(`${f.url}/api/roles`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), 'roles response is the bare array, as the router comment documents');
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    await f.close();
  }
});

test('standalone createApp: with PLAYGROUND_PASSWORD equal to the shipped default, /api/roles is still open (fail-closed is the embedded case\'s job)', async () => {
  const prev = process.env.PLAYGROUND_PASSWORD;
  process.env.PLAYGROUND_PASSWORD = SHIPPED_DEFAULT;
  const app = createApp();
  const f = await listen(app);
  try {
    const res = await get(`${f.url}/api/roles`);
    assert.equal(res.status, 200);
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    else delete process.env.PLAYGROUND_PASSWORD;
    await f.close();
  }
});

test('standalone createApp: with PLAYGROUND_PASSWORD set, /api/roles returns 401 without X-Playground-Password', async () => {
  const prev = process.env.PLAYGROUND_PASSWORD;
  process.env.PLAYGROUND_PASSWORD = 'a-real-password-from-env';
  const app = createApp();
  const f = await listen(app);
  try {
    const res = await get(`${f.url}/api/roles`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Playground password required');
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    else delete process.env.PLAYGROUND_PASSWORD;
    await f.close();
  }
});

test('standalone createApp: with PLAYGROUND_PASSWORD set, /api/roles returns 401 with a wrong X-Playground-Password', async () => {
  const prev = process.env.PLAYGROUND_PASSWORD;
  process.env.PLAYGROUND_PASSWORD = 'a-real-password-from-env';
  const app = createApp();
  const f = await listen(app);
  try {
    const res = await get(`${f.url}/api/roles`, { 'X-Playground-Password': 'wrong' });
    assert.equal(res.status, 401);
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    else delete process.env.PLAYGROUND_PASSWORD;
    await f.close();
  }
});

test('standalone createApp: with PLAYGROUND_PASSWORD set, /api/roles returns 200 with the correct X-Playground-Password', async () => {
  const prev = process.env.PLAYGROUND_PASSWORD;
  process.env.PLAYGROUND_PASSWORD = 'a-real-password-from-env';
  const app = createApp();
  const f = await listen(app);
  try {
    const res = await get(`${f.url}/api/roles`, { 'X-Playground-Password': 'a-real-password-from-env' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    else delete process.env.PLAYGROUND_PASSWORD;
    await f.close();
  }
});

test('standalone createApp: with PLAYGROUND_PASSWORD set, a different-length wrong password is still rejected (constant-time compare)', async () => {
  // timingSafeEqual only runs when the buffers are the same length; a shorter
  // or longer wrong pw must therefore still be rejected with 401, not crash.
  // The wrapper around timingSafeEqual in createApp() does the length check
  // first; this test pins that behaviour.
  const prev = process.env.PLAYGROUND_PASSWORD;
  process.env.PLAYGROUND_PASSWORD = 'correctpw';
  const app = createApp();
  const f = await listen(app);
  try {
    for (const wrong of ['', 'x', 'correctp', 'correctpwX']) {
      const res = await get(`${f.url}/api/roles`, { 'X-Playground-Password': wrong });
      assert.equal(res.status, 401, `wrong password ${JSON.stringify(wrong)} must be 401`);
    }
  } finally {
    if (prev !== undefined) process.env.PLAYGROUND_PASSWORD = prev;
    else delete process.env.PLAYGROUND_PASSWORD;
    await f.close();
  }
});
