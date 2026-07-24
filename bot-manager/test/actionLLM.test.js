import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionLLM } from '../src/llm/actionLLM.js';
import { MockChatLLM } from '../src/llm/mockChatLLM.js';

function fakeSession(overrides = {}) {
  return {
    role: 'interrogator',
    faction: 'loyalist',
    phase: 'day',
    round: 2,
    alive: true,
    playerCode: 'HR-BOT-deadbeef',
    conclaveCode: 'CONCL1',
    botIds: [],
    shortTermMemory: { items: [{ kind: 'chat_message', from: 'P-04', author: 'Alice', text: 'I am the Interrogator.' }] },
    notes: { size: 0, all: () => ({}) },
    tokensUsed: 0,
    ...overrides
  };
}

test('ActionLLM: parses a valid bare-JSON action on first try', async () => {
  const chat = new MockChatLLM(['{"kind":"night_action","verb":"interrogate","tier":2,"target":"P-04"}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: { kind: 'night_action_prompt', round: 2 } });
  assert.equal(action.kind, 'night_action');
  assert.equal(action.verb, 'interrogate');
  assert.equal(action.tier, 2);
  assert.equal(action.target, 'P-04');
});

test('ActionLLM: still parses the legacy fenced ```action block', async () => {
  const chat = new MockChatLLM(['Tell me a tale.\n```action\n{"kind":"pass"}\n```']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
});

test('ActionLLM: strips a <think> block before parsing', async () => {
  const chat = new MockChatLLM(['<think>I should vote P-04, this seems clear</think>{"kind":"vote","target":"P-04"}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'vote');
  assert.equal(action.target, 'P-04');
});

test('ActionLLM: retries once with a short nudge when the first response is unparseable', async () => {
  const chat = new MockChatLLM([
    'Just chit-chatting, no JSON at all.',
    '{"kind":"vote","target":"P-04","justification":"strange story"}'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: { kind: 'day_vote_prompt', round: 2 } });
  assert.equal(action.kind, 'vote');
  assert.equal(action.target, 'P-04');
  assert.equal(chat.calls, 2, 'two chat calls were attempted (initial + retry)');
  const secondMessages = chat.received[1];
  assert.equal(secondMessages.length, 3, 'retry sends system + original user + one short nudge — no accumulation of prior bad output');
  assert.match(secondMessages[2].content, /did not include a valid/i);
});

test('ActionLLM: nudge only echoes a short excerpt of the bad output, not the full response', async () => {
  const longJunk = 'x'.repeat(5000);
  const chat = new MockChatLLM([longJunk, '{"kind":"pass"}']);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const nudge = chat.received[1][2].content;
  assert.ok(nudge.length < 700, `nudge message (${nudge.length} chars) should stay well under the full ${longJunk.length}-char bad output`);
});

test('ActionLLM: when all retries fail, returns pass', async () => {
  const chat = new MockChatLLM(['ramble, no json', 'still nothing']);
  const a = new ActionLLM({ chatModel: chat, maxRetries: 1 });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
  assert.equal(chat.calls, 2);
});

test('ActionLLM: malformed JSON inside a fenced block is rejected, retries', async () => {
  const chat = new MockChatLLM(['```action\n{malformed json}\n```', '{"kind":"chat","text":"hi"}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'chat');
  assert.equal(action.text, 'hi');
});

test('ActionLLM: action with unknown kind is rejected and triggers retry', async () => {
  const chat = new MockChatLLM(['{"kind":"explode"}', '{"kind":"pass"}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
});

test('ActionLLM: token accounting uses usage.total_tokens on every call, including pass', async () => {
  const session = fakeSession({ tokensUsed: 0 });
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { total_tokens: 250 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.equal(session.tokensUsed, 250, 'pass calls still bump tokensUsed from usage.total_tokens');
});

test('ActionLLM: falls back to a char-estimate when usage is missing', async () => {
  const session = fakeSession({ tokensUsed: 0 });
  const chat = new MockChatLLM(['{"kind":"pass"}']); // no usage object
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.ok(session.tokensUsed > 0, 'char-estimate fallback still bumps tokensUsed');
});

test('ActionLLM: notes from action acceptance are returned unwrapped (session persists them later)', async () => {
  const chat = new MockChatLLM(['{"kind":"pass","notes":{"P-02-suspicion":"shifty"}}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.deepEqual(action.notes, { 'P-02-suspicion': 'shifty' });
});

test('ActionLLM: chat call error → falls through to pass', async () => {
  const badChat = { async chat() { throw new Error('boom'); } };
  const a = new ActionLLM({ chatModel: badChat, maxRetries: 1 });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
});
