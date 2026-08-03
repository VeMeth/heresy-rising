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

// --- MiniMax cases (plan §3.9 case 3 & 4) ---

test('stripThink: orphan </think> with no opener drops everything up to and including the closing tag', () => {
  assert.equal(
    stripThink('the killer is probably P-02 based on their pattern</think>{"kind":"pass"}'),
    '{"kind":"pass"}'
  );
});

test('stripThink: orphan </think> — multiple stray closers drop up to the LAST one', () => {
  const text = 'first thought</think> stray text </think>{"kind":"pass"}';
  assert.equal(stripThink(text), '{"kind":"pass"}');
});

test('stripThink: a lone </think> with nothing after it strips to empty', () => {
  assert.equal(stripThink('some reasoning that trails off</think>'), '');
});

test('parseActionBlock: orphan </think> case parses cleanly end to end', () => {
  const text = 'reasoning about P-03 being suspicious</think>{"kind":"vote","target":"P-03"}';
  assert.deepEqual(parseActionBlock(text), { kind: 'vote', target: 'P-03' });
});

test('parseActionBlock: last-resort balanced-brace scan finds a trailing action after prose with no fence', () => {
  const text = 'I have considered the evidence carefully. {"kind":"vote","target":"P-01","notes":{"suspicion":"high","reason":"quiet"}} That is my choice.';
  const r = parseActionBlock(text);
  assert.deepEqual(r, { kind: 'vote', target: 'P-01', notes: { suspicion: 'high', reason: 'quiet' } });
});

test('parseActionBlock: last-resort scan prefers the LAST balanced object when more than one is present', () => {
  const text = 'Draft: {"kind":"pass"} — actually, final answer: {"kind":"vote","target":"P-04"}';
  const r = parseActionBlock(text);
  assert.deepEqual(r, { kind: 'vote', target: 'P-04' });
});

test('parseActionBlock: last-resort scan does not fire on prose that merely contains braces', () => {
  assert.equal(parseActionBlock('The score was {2-1} and {3-0} in the other match.'), null);
});

test('parseActionBlock: last-resort scan is not confused by apostrophes in surrounding prose', () => {
  const text = "I don't think it's P-01. My real answer: {\"kind\":\"vote\",\"target\":\"P-02\"}";
  const r = parseActionBlock(text);
  assert.deepEqual(r, { kind: 'vote', target: 'P-02' });
});

test('parseActionBlock: last-resort scan combined with orphan </think> stripping', () => {
  const text = 'reasoning about P-03 being suspicious</think>Final decision: {"kind":"vote","target":"P-03"} — locking it in.';
  const r = parseActionBlock(text);
  assert.deepEqual(r, { kind: 'vote', target: 'P-03' });
});
