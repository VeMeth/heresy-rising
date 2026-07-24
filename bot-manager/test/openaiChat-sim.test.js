import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeOpenAI } from './fakeOpenAI.js';
import { OpenAIChat } from '../src/llm/openaiChat.js';
import { ActionLLM } from '../src/llm/actionLLM.js';

test('OpenAIChat + fakeOpenAI: structured output path — response_format sent, action parsed', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"chat","text":"Greetings, conclave."}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, model: 'qwen/qwen3-14b', maxRetries: 0 });
    const llm = new ActionLLM({ chatModel: chat });
    const action = await llm.generate({ session: { tokensUsed: 0 }, prompt: { kind: 'chat_turn' } });
    assert.equal(action.kind, 'chat');
    assert.ok(fake.received[0].response_format, 'first request carried response_format');
  } finally { await fake.close(); }
});

test('OpenAIChat + fakeOpenAI: 400 on response_format falls back to fenced/bare JSON permanently', async () => {
  const fake = await startFakeOpenAI({ supportsJsonSchema: false, scripts: ['```action\n{"kind":"pass"}\n```', '{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, model: 'qwen/qwen3-14b', maxRetries: 1 });
    const llm = new ActionLLM({ chatModel: chat });
    const first = await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.equal(first.kind, 'pass');
    assert.equal(chat.structuredOutputSupported, false, 'permanently disabled after the 400');

    await llm.generate({ session: { tokensUsed: 0 }, prompt: {} });
    assert.ok(!fake.received[fake.received.length - 1].response_format, 'later calls never resend response_format');
  } finally { await fake.close(); }
});

test('OpenAIChat + fakeOpenAI: usage.total_tokens flows through to session.tokensUsed', async () => {
  const fake = await startFakeOpenAI({ scripts: ['{"kind":"pass"}'] });
  try {
    const chat = new OpenAIChat({ baseUrl: fake.baseUrl, maxRetries: 0 });
    const llm = new ActionLLM({ chatModel: chat });
    const session = { tokensUsed: 0 };
    await llm.generate({ session, prompt: {} });
    assert.equal(session.tokensUsed, 120); // fakeOpenAI always reports total_tokens: 120
  } finally { await fake.close(); }
});
