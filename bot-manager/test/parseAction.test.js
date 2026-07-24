import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActionBlock, stripThink } from '../src/llm/parseAction.js';

test('stripThink: removes a closed <think> block', () => {
  assert.equal(stripThink('<think>reasoning here</think>{"kind":"pass"}'), '{"kind":"pass"}');
});

test('stripThink: drops everything from an unclosed <think> tag onward', () => {
  assert.equal(stripThink('preamble <think>never closes, generation got cut off'), 'preamble');
});

test('stripThink: no-op when there is no think tag', () => {
  assert.equal(stripThink('{"kind":"pass"}'), '{"kind":"pass"}');
});

test('parseActionBlock: accepts bare JSON with no fence at all', () => {
  assert.deepEqual(parseActionBlock('{"kind":"pass"}'), { kind: 'pass' });
});

test('parseActionBlock: bare JSON tolerates surrounding whitespace', () => {
  assert.deepEqual(parseActionBlock('  \n{"kind":"chat","text":"hi"}\n  '), { kind: 'chat', text: 'hi' });
});

test('parseActionBlock: strips a leading <think> block before accepting bare JSON', () => {
  const r = parseActionBlock('<think>I should vote for P-04 because...</think>{"kind":"vote","target":"P-04"}');
  assert.deepEqual(r, { kind: 'vote', target: 'P-04' });
});

test('parseActionBlock: bare-JSON path requires a "kind" field — falls through otherwise', () => {
  assert.equal(parseActionBlock('{"foo":"bar"}'), null);
});

test('parseActionBlock: still finds a fenced ```action block after an unclosed think tag has been stripped', () => {
  // Defensive case: if <think> never closes, everything after it is dropped,
  // including any action block that happened to follow it — there is no
  // reliable content past a truncated thinking block.
  const r = parseActionBlock('<think>reasoning...\n```action\n{"kind":"pass"}\n```');
  assert.equal(r, null);
});

test('parseActionBlock: preamble text + closed think block + fenced action block all resolve correctly', () => {
  const text = 'Let me consider this.\n<think>internal reasoning</think>\nHere is my move:\n```action\n{"kind":"vote","target":"P-02","justification":"suspicious silence"}\n```';
  const r = parseActionBlock(text);
  assert.equal(r.kind, 'vote');
  assert.equal(r.target, 'P-02');
});
