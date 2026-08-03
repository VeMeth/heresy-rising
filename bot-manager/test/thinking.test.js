// test/thinking.test.js — plan §3.9 acceptance criteria (§6.4): MiniMax's
// thinking behaviour across the transport (openaiChat.js) and parser
// (parseAction.js) layers. This is the regression suite for the failure in
// plan §1.1 — a truncated <think> block silently turning into a passed
// turn while billing real money — plus the reasoning_split negotiation and
// the four stripThink/parseActionBlock cases that make MiniMax usable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeOpenAI } from './fakeOpenAI.js';
import { OpenAIChat } from '../src/llm/openaiChat.js';
import { ActionLLM } from '../src/llm/actionLLM.js';

test('§1.1 regression: a truncated unclosed <think> at maxTokens=350 yields empty parse -> pass', async () => {
  const truncated = '<think>Let me think this through carefully. The killer is likely P-03 because they were quiet during the';
  const fake = await startFakeOpenAI({ scripts: [{ content: truncated, finishReason: 'length' }] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'minimax', model: 'MiniMax-M2.7', maxTokens: 350, maxRetries: 0 });
    const llm = new ActionLLM({ chatModel: chat, maxRetries: 0 });
    const action = await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.deepEqual(action, { kind: 'pass' }, 'the bug is real: truncated thinking produces a silent pass');
  } finally { await fake.close(); }
});

test('the same content parses fine once the think block is complete', async () => {
  const complete = '<think>Let me think this through carefully. The killer is likely P-03.</think>{"kind":"vote","target":"P-03"}';
  const fake = await startFakeOpenAI({ scripts: [{ content: complete, finishReason: 'stop' }] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'minimax', model: 'MiniMax-M2.7', maxTokens: 4096, maxRetries: 0 });
    const llm = new ActionLLM({ chatModel: chat, maxRetries: 0 });
    const action = await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.equal(action.kind, 'vote');
    assert.equal(action.target, 'P-03');
  } finally { await fake.close(); }
});

test('orphan </think> with no opener still parses (MiniMax pre-fills the opening tag server-side)', async () => {
  const orphan = 'the killer is probably P-02 based on their voting pattern</think>{"kind":"vote","target":"P-02"}';
  const fake = await startFakeOpenAI({ scripts: [orphan] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'minimax', model: 'MiniMax-M2.7', maxRetries: 0 });
    const llm = new ActionLLM({ chatModel: chat, maxRetries: 0 });
    const action = await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.equal(action.kind, 'vote');
    assert.equal(action.target, 'P-02');
  } finally { await fake.close(); }
});

test('a 400 on reasoning_split falls back permanently, retries without it, and still yields an action', async () => {
  const fake = await startFakeOpenAI({ supportsReasoningSplit: false, scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({
      baseUrl: fake.baseUrl, provider: 'minimax', model: 'MiniMax-M2.7',
      reasoningSplit: true, structuredOutput: false, maxRetries: 0
    });
    const llm = new ActionLLM({ chatModel: chat });
    const action = await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.equal(action.kind, 'pass');
    assert.equal(chat.reasoningSplitSupported, false, 'permanently disabled after the 400');
    assert.ok(!fake.received[fake.received.length - 1].reasoning_split, 'later calls never resend reasoning_split');
  } finally { await fake.close(); }
});

test("finish_reason: 'length' is surfaced on the chat() return", async () => {
  const fake = await startFakeOpenAI({ scripts: [{ content: '{"kind":"pass"}', finishReason: 'length' }] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, maxRetries: 0 });
    const result = await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.finishReason, 'length');
  } finally { await fake.close(); }
});

test('a local-profile payload never contains reasoning_split', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'local', maxRetries: 0 });
    await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.ok(!('reasoning_split' in fake.received[0]), 'local payload must never carry reasoning_split');
  } finally { await fake.close(); }
});

test('reasoningSplit=true is ignored on provider:local (defense in depth against a misconfigured caller)', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'local', reasoningSplit: true, maxRetries: 0 });
    assert.equal(chat.reasoningSplitSupported, false);
    await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.ok(!('reasoning_split' in fake.received[0]));
  } finally { await fake.close(); }
});

test('both fallbacks (json_schema then reasoning_split) firing in sequence still terminates and succeeds', async () => {
  const fake = await startFakeOpenAI({ supportsJsonSchema: false, supportsReasoningSplit: false, scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({
      baseUrl: fake.baseUrl, provider: 'minimax', model: 'MiniMax-M2.7',
      structuredOutput: true, reasoningSplit: true, maxRetries: 0
    });
    const result = await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.content, '{"kind":"pass"}');
    assert.equal(chat.structuredOutputSupported, false);
    assert.equal(chat.reasoningSplitSupported, false);
    // fake.calls() only counts successfully-consumed script slots (one, for
    // the eventual 200); received.length counts every HTTP round-trip,
    // including the two rejected ones each fallback recovered from.
    assert.equal(fake.received.length, 3, 'response_format rejected, then reasoning_split rejected, then success');
  } finally { await fake.close(); }
});

test('minimax provider sends both max_completion_tokens and max_tokens with the same value', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'minimax', maxTokens: 4096, maxRetries: 0 });
    await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(fake.received[0].max_completion_tokens, 4096);
    assert.equal(fake.received[0].max_tokens, 4096);
  } finally { await fake.close(); }
});

test('local provider sends only max_tokens, never max_completion_tokens', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'local', maxTokens: 350, maxRetries: 0 });
    await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(fake.received[0].max_tokens, 350);
    assert.ok(!('max_completion_tokens' in fake.received[0]));
  } finally { await fake.close(); }
});

test('reasoningText is surfaced from reasoning_content when reasoning-split is active', async () => {
  const fake = await startFakeOpenAI({ scripts: [{ content: '{"kind":"pass"}', reasoningContent: 'internal thought trace' }] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'minimax', reasoningSplit: true, maxRetries: 0 });
    const result = await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.reasoningText, 'internal thought trace');
    assert.ok(fake.received[0].reasoning_split, 'reasoning_split sent for minimax');
  } finally { await fake.close(); }
});

test('reasoningText stays undefined when reasoning-split is not active', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, provider: 'local', maxRetries: 0 });
    const result = await chat.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.reasoningText, undefined);
  } finally { await fake.close(); }
});
