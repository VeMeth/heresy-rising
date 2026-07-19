import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActionBlock, normalizeAction } from '../src/llm/parseAction.js';
import { buildEnginePayload } from '../src/actionDispatch.js';

const session = (overrides = {}) => ({ conclaveCode: 'CONCL1', playerCode: 'HR-BOT-deadbeef', faction: 'loyalist', ...overrides });

test('parseActionBlock: extracts the JSON inside ```action fenced blocks', () => {
  const text = 'I will sleep tonight.\n```action\n{"kind":"night_action","verb":"sleep","target":null}\n```';
  assert.deepEqual(parseActionBlock(text), { kind: 'night_action', verb: 'sleep', target: null });
});

test('parseActionBlock: returns the LAST action block when several are present', () => {
  const text = '```action\n{"kind":"pass"}\n```\nThen I reconsider.\n```action\n{"kind":"chat","text":"I think P-02 is lying."}\n```';
  const r = parseActionBlock(text);
  assert.equal(r.kind, 'chat');
  assert.match(r.text, /lying/);
});

test('parseActionBlock: tolerates whitespace between backticks and "action"', () => {
  const text = '```  action\n{"kind":"pass"}\n```';
  assert.deepEqual(parseActionBlock(text), { kind: 'pass' });
});

test('parseActionBlock: returns null when no fenced block exists', () => {
  assert.equal(parseActionBlock('just chit-chat, no action block'), null);
  assert.equal(parseActionBlock('```json\n{"foo":"bar"}\n```'), null);
});

test('parseActionBlock: returns null when JSON is malformed', () => {
  assert.equal(parseActionBlock('```action\n{not: valid]\n```'), null);
});

test('normalizeAction: rejects unknown kinds', () => {
  assert.equal(normalizeAction({ kind: 'explode' }), null);
  assert.equal(normalizeAction(null), null);
  assert.equal(normalizeAction('not-an-object'), null);
});

test('normalizeAction: passes through valid kinds, truncates notes', () => {
  const longKey = 'k-' + 'x'.repeat(100);
  const longVal = 'v'.repeat(600);
  const r = normalizeAction({ kind: 'chat', text: 'hi', notes: { [longKey]: longVal } });
  assert.equal(r.kind, 'chat');
  assert.equal(r.text, 'hi');
  // The key is truncated to 64 chars max, the value to 500. Get the only key:
  const ks = Object.keys(r.notes);
  assert.equal(ks.length, 1);
  assert.ok(ks[0].length <= 64);
  assert.ok(r.notes[ks[0]].length <= 500);
});

test('buildEnginePayload: chat → chat:send', () => {
  const r = buildEnginePayload({ kind: 'chat', text: 'I think P-04 is suspicious.' }, session());
  assert.equal(r.type, 'chat');
  assert.equal(r.payload.code, 'CONCL1');
  assert.equal(r.payload.channel, 'public');
  assert.match(r.payload.body, /suspicious/);
});

test('buildEnginePayload: vote with explicit skip', () => {
  const r = buildEnginePayload({ kind: 'vote', target: null, justification: 'no movement' }, session());
  assert.equal(r.type, 'vote');
  assert.equal(r.payload.targetCode, 'skip');
  assert.equal(r.payload.justification, 'no movement');
});

test('buildEnginePayload: vote for a target player code', () => {
  const r = buildEnginePayload({ kind: 'vote', target: 'HR-otherplayer-1', justification: 'strange votes' }, session());
  assert.equal(r.type, 'vote');
  assert.equal(r.payload.targetCode, 'HR-otherplayer-1');
});

test('buildEnginePayload: interrogator night_action maps verb→investigate, variant→T#', () => {
  const r = buildEnginePayload({ kind: 'night_action', verb: 'interrogate', tier: 2, target: 'P-zzz' }, session());
  assert.equal(r.type, 'action');
  assert.equal(r.payload.target, undefined); // payload uses targetCode
  assert.equal(r.payload.targetCode, 'P-zzz');
  assert.equal(r.payload.variant, 'T2');
});

test('buildEnginePayload: priest sermon uses sermonTier as variant', () => {
  const r = buildEnginePayload({ kind: 'night_action', verb: 'sermon', sermonTier: 'whisper', target: 'P-zzz' }, session());
  assert.equal(r.type, 'action');
  assert.equal(r.payload.variant, 'whisper');
});

test('buildEnginePayload: heretic priest warp_litany passes through unchanged', () => {
  const r = buildEnginePayload({ kind: 'night_action', verb: 'sermon', sermonTier: 'warp-litany', target: 'P-zzz' }, session({ faction: 'heretic' }));
  assert.equal(r.type, 'action');
  assert.equal(r.payload.variant, 'warp-litany');
});

test('buildEnginePayload: protect / bodyguard / scan_drift / kill / recruit carry no variant', () => {
  for (const verb of ['protect', 'bodyguard', 'scan_drift', 'kill', 'recruit']) {
    const r = buildEnginePayload({ kind: 'night_action', verb, target: 'P-zzz', tier: 2 }, session());
    assert.equal(r.type, 'action', `${verb} should resolve to action`);
    assert.equal(r.payload.variant, null, `${verb} should have null variant`);
    assert.equal(r.payload.targetCode, 'P-zzz');
  }
});

test('buildEnginePayload: sleep → emit nothing (pass-style)', () => {
  const r = buildEnginePayload({ kind: 'night_action', verb: 'sleep', target: null }, session());
  assert.equal(r.type, 'sleep');
  assert.equal(r.payload, null);
});

test('buildEnginePayload: pass → no-op', () => {
  const r = buildEnginePayload({ kind: 'pass' }, session());
  assert.equal(r.type, 'pass');
});

test('buildEnginePayload: rejects malformed input gracefully', () => {
  assert.equal(buildEnginePayload(null, session()), null);
  assert.equal(buildEnginePayload({ kind: 'explode' }, session()), null);
  assert.equal(buildEnginePayload({ kind: 'night_action', verb: 'unknown_verb' }, session()), null);
});

test('buildEnginePayload: forge includes asPlayerCode and body', () => {
  const r = buildEnginePayload({ kind: 'night_action', verb: 'forge', target: null, asPlayerCode: 'P-zzz', text: 'I never said this.' }, session());
  assert.equal(r.type, 'action');
  assert.equal(r.payload.asPlayerCode, 'P-zzz');
  assert.match(r.payload.body, /never said/);
});