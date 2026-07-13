import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, isRequestOriginAllowed, publicPresetMetadata } from '../src/index.js';
import { requirePlayerCode } from '../src/utils.js';

test('public setup metadata does not expose role composition', () => {
  assert.deepEqual(publicPresetMetadata(7), { count: 7, minPlayers: 5, maxPlayers: 12 });
  assert.equal('roles' in publicPresetMetadata(7), false);
  assert.equal('roleDefinitions' in publicPresetMetadata(7), false);
});

test('bearer player codes are normalized and length-checked', () => {
  assert.equal(requirePlayerCode(' HR-SECURITY-PLAYER!! '), 'HR-SECURITY-PLAYER');
  assert.throws(() => requirePlayerCode('short'), /playerCode/);
});

test('unapproved browser origins are rejected by allowlist helper', () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed('https://game.example', ['https://game.example']), true);
  assert.equal(isOriginAllowed('https://evil.example', ['https://game.example']), false);
  assert.equal(isOriginAllowed('https://evil.example', '*'), true);
});

test('websocket origin check allows same-origin reverse proxy hosts', () => {
  assert.equal(isRequestOriginAllowed({
    headers: { origin: 'http://opclw.blockchonk.me:8281', host: 'opclw.blockchonk.me:8281' }
  }, ['http://localhost:8281']), true);
  assert.equal(isRequestOriginAllowed({
    headers: { origin: 'http://evil.example', host: 'opclw.blockchonk.me:8281' }
  }, ['http://localhost:8281']), false);
});
