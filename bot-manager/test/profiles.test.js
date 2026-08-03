import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { PROFILES } from '../src/llm/profiles.js';
import { resolveProfile, llmFor, listProfiles, _resetLLMCacheForTests } from '../src/llm/registry.js';
import { PassThroughLLM } from '../src/llm/passthroughLLM.js';

test('resolveProfile: no name / undefined / null / empty string all resolve to the default profile (local, with no BOT_DEFAULT_PROFILE set)', () => {
  const expected = config.botDefaultProfile || 'local';
  assert.equal(resolveProfile().id, expected);
  assert.equal(resolveProfile(undefined).id, expected);
  assert.equal(resolveProfile(null).id, expected);
  assert.equal(resolveProfile('').id, expected);
});

test('resolveProfile: unknown profile name throws', () => {
  assert.throws(() => resolveProfile('nonsense'), /Unknown bot profile/);
});

test('listProfiles: never leaks baseUrl or apiKey (security requirement, plan §3.8)', () => {
  const rows = listProfiles();
  assert.equal(rows.length, Object.keys(PROFILES).length);
  for (const row of rows) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'baseUrl'), false, `${row.id} row must not have baseUrl`);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'apiKey'), false, `${row.id} row must not have apiKey`);
  }
  // Belt-and-braces: whatever the underlying profile's baseUrl/apiKey values
  // are (from this environment's config), none of them appear anywhere in
  // the serialised listing.
  const json = JSON.stringify(rows);
  for (const p of Object.values(PROFILES)) {
    if (p.apiKey) assert.doesNotMatch(json, new RegExp(p.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (p.baseUrl) assert.doesNotMatch(json, new RegExp(p.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const shape = rows[0];
  assert.deepEqual(Object.keys(shape).sort(), ['available', 'contextWindow', 'costCeilingUsd', 'id', 'label', 'model', 'provider'].sort());
});

test('llmFor: caches one instance per profile id (per-client state like _structuredOutputSupported must survive across calls)', () => {
  _resetLLMCacheForTests();
  const a = llmFor('local');
  const b = llmFor('local');
  assert.equal(a, b, 'expected the exact same cached instance, not an equal-but-different one');
});

test('llmFor: an unavailable profile (no MINIMAX_API_KEY in this environment) resolves to a PassThroughLLM', () => {
  assert.equal(PROFILES['minimax-m2.7'].available, false, 'test assumes MINIMAX_API_KEY is unset in the test environment');
  _resetLLMCacheForTests();
  const llm = llmFor('minimax-m2.7');
  assert.ok(llm instanceof PassThroughLLM);
});

test('local-invariance: the local profile matches pre-profile hardcoded behaviour exactly (plan §3.2 CRITICAL INVARIANT)', () => {
  const p = PROFILES.local;
  assert.equal(p.maxTokens, 350);
  assert.equal(p.temperature, 0.7);
  assert.equal(p.topP, 0.9);
  assert.equal(p.structuredOutput, true);
  assert.equal(p.noThinkSuffix, true);
  assert.equal(p.reasoningSplit, false);
  assert.equal(p.budgetScale, 1);
  assert.equal(p.memoryWindow, 20);
  assert.equal(p.noteKeys, 15);
  assert.equal(p.minChatLines, 6);
  assert.equal(p.timeoutMs, 120000);
  assert.equal(p.lane, 'local');
  assert.equal(p.costCeilingTokens, config.maxTokensPerGame);
  // Cost gate must never fire for local: zero price, unbounded USD ceiling.
  assert.equal(p.usdPerMTokIn, 0);
  assert.equal(p.usdPerMTokOut, 0);
  assert.equal(p.costCeilingUsd, Infinity);
});

test('profile objects are frozen', () => {
  assert.ok(Object.isFrozen(PROFILES.local));
  assert.ok(Object.isFrozen(PROFILES['minimax-m2.7']));
  assert.ok(Object.isFrozen(PROFILES['minimax-m3']));
});
