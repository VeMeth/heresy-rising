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

test('ActionLLM: parses a valid action on first try', async () => {
  const chat = new MockChatLLM(['Tell me a tale.\n```action\n{"kind":"night_action","verb":"interrogate","tier":2,"target":"P-04"}\n```']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: { kind: 'night_action_prompt', round: 2 } });
  assert.equal(action.kind, 'night_action');
  assert.equal(action.verb, 'interrogate');
  assert.equal(action.tier, 2);
  assert.equal(action.target, 'P-04');
});

test('ActionLLM: retries once with a nudge when the first response has no action block', async () => {
  const chat = new MockChatLLM([
    'Just chit-chatting, forgot the action block.',
    'Sorry. Here you go.\n```action\n{"kind":"vote","target":"P-04","justification":"strange story"}\n```'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: { kind: 'day_vote_prompt', round: 2 } });
  assert.equal(action.kind, 'vote');
  assert.equal(action.target, 'P-04');
  assert.equal(chat.calls, 2, 'two chat invokes were attempted (initial + retry)');
  // Second invoke should have included the AI noise + a human nudge.
  const secondMessages = chat.received[1];
  assert.ok(secondMessages.length >= 4, 'second invoke includes the prior messages + a nudge');
  const lastMessage = secondMessages[secondMessages.length - 1];
  const nudgeContent = typeof lastMessage.content === 'string' ? lastMessage.content : lastMessage.content;
  assert.match(nudgeContent, /fix your action block/i);
});

test('ActionLLM: when all retries fail, returns pass', async () => {
  const chat = new MockChatLLM([
    'ramble without a fence',
    'still no block here'
  ]);
  const a = new ActionLLM({ chatModel: chat, maxRetries: 1 });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
  assert.equal(chat.calls, 2);
});

test('ActionLLM: rejects malformed action JSON in the block, retries', async () => {
  const chat = new MockChatLLM([
    '```action\n{malformed json}\n```',
    '```action\n{"kind":"chat","text":"hi"}\n```'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'chat');
  assert.equal(action.text, 'hi');
});

test('ActionLLM: action with unknown kind is rejected and triggers retry', async () => {
  const chat = new MockChatLLM([
    '```action\n{"kind":"explode"}\n```',
    '```action\n{"kind":"pass"}\n```'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
});

test('ActionLLM: persists completion tokens back to the session', async () => {
  const session = fakeSession({ tokensUsed: 0 });
  const chat = new MockChatLLM(['```action\n{"kind":"pass"}\n```\n' + 'x'.repeat(400)]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  // parseActionBlock pulls the FIRST ```action``` block; the 400 extra chars
  // go to the (rough) token-count fallback but pass doesn't bump tokens.
  // We assert token counts *only* on non-pass actions:
  const session2 = fakeSession({ tokensUsed: 0 });
  const chat2 = new MockChatLLM(['```action\n{"kind":"chat","text":"hi"}\n```\n' + 'x'.repeat(400)]);
  const a2 = new ActionLLM({ chatModel: chat2 });
  await a2.generate({ session: session2, prompt: {} });
  assert.ok(session2.tokensUsed > 0, 'non-pass action bumps tokensUsed');
});

test('ActionLLM: notes from action acceptance are returned unwrapped (session persists them later)', async () => {
  const chat = new MockChatLLM(['```action\n{"kind":"pass","notes":{"P-02-suspicion":"shifty"}}\n```']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.deepEqual(action.notes, { 'P-02-suspicion': 'shifty' });
});

test('ActionLLM: chat.invoke error → falls through to pass', async () => {
  const badChat = {
    async invoke() { throw new Error('boom'); }
  };
  const a = new ActionLLM({ chatModel: badChat, maxRetries: 1 });
  const action = await a.generate({ session: fakeSession(), prompt: {} });
  assert.equal(action.kind, 'pass');
});