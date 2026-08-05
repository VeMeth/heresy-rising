import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionLLM } from '../src/llm/actionLLM.js';
import { MockChatLLM } from '../src/llm/mockChatLLM.js';
import { BotSession } from '../src/session.js';
import { PROFILES } from '../src/llm/profiles.js';
import { spentLast24h, _resetSpendForTests } from '../src/llm/registry.js';

// Mirrors actionLLM.test.js's fakeSession — kept local rather than shared
// across test files (each file's fixtures are self-contained by convention
// in this suite), extended with the cost-accounting fields (_profile,
// costUsd, reasoningTokens) that a real BotSession sets in its constructor
// but a bare fake object must opt into per test.
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

// Minimal chat double that (unlike MockChatLLM) forwards `finishReason` —
// needed for the truncation-nudge test, since MockChatLLM's `{content,
// usage}` reply shape predates A3's additive `finishReason` field.
function fakeChat(responses) {
  let calls = 0;
  const received = [];
  return {
    received,
    get calls() { return calls; },
    async chat(messages) {
      received.push(messages);
      return responses[calls++] || { content: '', usage: {} };
    }
  };
}

// Matches sim-mocked.test.js's cfg() shape — the minimal config BotSession
// needs, independent of the real process env's .env file.
const cfg = (overrides = {}) => ({
  heresyBotPort: 7878,
  heresyGameHost: 'mock',
  botApiKey: 'b',
  adminApiKey: 'a',
  simBypassToken: 's',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: 'qwen/qwen3-14b',
  maxBotSessions: 12,
  maxBotsPerGame: 4,
  llmTimeoutMs: 30,
  llmTemperature: 0.7,
  maxTokens: 350,
  topP: 0.9,
  maxTokensPerGame: 200000,
  botActionDelayMs: 0,
  maxRetries: 1,
  botFactionChat: false,
  ...overrides
});

const passLLM = { async generate() { return { kind: 'pass' }; } };

// --- ActionLLM cost accounting (plan §3.5) ---

test('ActionLLM: USD accrues from a prompt/completion usage split at the profile rate', async () => {
  const profile = PROFILES['minimax-m2.7'];
  const session = fakeSession({ _profile: profile, costUsd: 0 });
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { prompt_tokens: 10000, completion_tokens: 2000 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  const expected = (10000 / 1e6) * profile.usdPerMTokIn + (2000 / 1e6) * profile.usdPerMTokOut;
  assert.ok(Math.abs(session.costUsd - expected) < 1e-9, `expected costUsd≈${expected}, got ${session.costUsd}`);
  assert.equal(session.tokensUsed, 12000, 'tokensUsed still sums prompt+completion when no total_tokens is sent');
});

test('ActionLLM: local profile accrues zero USD regardless of usage volume', async () => {
  const profile = PROFILES.local;
  const session = fakeSession({ _profile: profile, costUsd: 0 });
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { prompt_tokens: 500000, completion_tokens: 500000 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.equal(session.costUsd, 0, 'local has usdPerMTokIn/Out of 0, so cost must stay exactly zero');
});

test('ActionLLM: a missing/unset profile on the session is treated as zero-cost (sessionless/test path)', async () => {
  const session = fakeSession({ costUsd: 0 }); // no _profile at all
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { prompt_tokens: 9999, completion_tokens: 9999 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.equal(session.costUsd, 0);
});

test('ActionLLM: reasoning_tokens land on session.reasoningTokens without being billed twice', async () => {
  const profile = PROFILES['minimax-m2.7'];
  const session = fakeSession({ _profile: profile, costUsd: 0, reasoningTokens: 0 });
  const chat = new MockChatLLM([{
    content: '{"kind":"pass"}',
    usage: { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } }
  }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.equal(session.reasoningTokens, 300);
  // reasoning_tokens are already inside completion_tokens (500) — costUsd
  // must reflect exactly the 1000-in/500-out split, not 500+300 out.
  const expected = (1000 / 1e6) * profile.usdPerMTokIn + (500 / 1e6) * profile.usdPerMTokOut;
  assert.ok(Math.abs(session.costUsd - expected) < 1e-9, `reasoning tokens must not double-bill; expected ${expected}, got ${session.costUsd}`);
});

test('ActionLLM: recordSpend is called with the USD delta (feeds the process-wide daily cap)', async () => {
  _resetSpendForTests();
  const profile = PROFILES['minimax-m2.7'];
  const session = fakeSession({ _profile: profile, costUsd: 0 });
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { prompt_tokens: 10000, completion_tokens: 2000 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  const expected = (10000 / 1e6) * profile.usdPerMTokIn + (2000 / 1e6) * profile.usdPerMTokOut;
  assert.ok(Math.abs(spentLast24h() - expected) < 1e-9, `expected recordSpend to have logged ≈${expected}, spentLast24h()=${spentLast24h()}`);
});

test('ActionLLM: zero-cost calls (local) never touch recordSpend', async () => {
  _resetSpendForTests();
  const before = spentLast24h();
  const session = fakeSession({ _profile: PROFILES.local, costUsd: 0 });
  const chat = new MockChatLLM([{ content: '{"kind":"pass"}', usage: { prompt_tokens: 1000, completion_tokens: 1000 } }]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session, prompt: {} });
  assert.equal(spentLast24h(), before, 'a zero-priced call must not add to the rolling spend log');
});

// --- Nudge echo: think-stripped, not raw (plan §3.9 actionLLM half) ---

test('ActionLLM: nudge echoes think-stripped text, not the raw <think> content', async () => {
  const chat = new MockChatLLM([
    '<think>I am pondering whether to vote or pass, lots of internal monologue here</think>not valid json after all',
    '{"kind":"pass"}'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const nudge = chat.received[1][2].content;
  assert.ok(!nudge.includes('<think>'), 'nudge must not contain the raw <think> tag');
  assert.match(nudge, /not valid json after all/);
});

test('ActionLLM: nudge falls back to the fixed line when the response was all reasoning', async () => {
  // Unclosed <think> at the very start — stripThink() drops from the tag
  // onward, leaving nothing to echo.
  const chat = new MockChatLLM([
    '<think>thinking thinking thinking, never got to the action',
    '{"kind":"pass"}'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const nudge = chat.received[1][2].content;
  assert.match(nudge, /contained only reasoning and was cut off before the action/);
});

test('ActionLLM: finishReason "length" triggers the terse truncation nudge instead of the echo', async () => {
  const chat = fakeChat([
    { content: '<think>ran out of space while thinking', usage: {}, finishReason: 'length' },
    { content: '{"kind":"pass"}', usage: {} }
  ]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const nudge = chat.received[1][2].content;
  assert.equal(nudge, 'Do not explain. Emit ONLY the JSON action object.');
});

test('ActionLLM: a finishReason other than "length" still gets the normal echoing nudge', async () => {
  const chat = fakeChat([
    { content: 'no json here', usage: {}, finishReason: 'stop' },
    { content: '{"kind":"pass"}', usage: {} }
  ]);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const nudge = chat.received[1][2].content;
  assert.match(nudge, /did not include a valid/i);
});

// --- BotSession: profile plumbing, USD budget gate, snapshot round-trip ---

test('BotSession: resolves profileId/_profile in the constructor and exposes costUsd on inspect()', () => {
  const session = new BotSession({
    id: 'HR-BOT-cost-a', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-cost-a', name: 'Cost-Bot',
    config: cfg(), llm: passLLM, profileId: 'minimax-m2.7', engineBaseUrl: ''
  });
  assert.equal(session.profileId, 'minimax-m2.7');
  assert.equal(session._profile, PROFILES['minimax-m2.7']);
  session.costUsd = 0.42;
  assert.equal(session.inspect().costUsd, 0.42);
  assert.equal(session.inspect().profile, 'minimax-m2.7');
});

test('BotSession: inspect() exposes phaseSummaries + a count so the admin panel can see long-term memory at a glance', () => {
  // Regression: the LLM-generated phase-end summaries were appended to
  // session.phaseSummaries and rendered in the prompt, but the inspect()
  // payload (what /bots/:id returns to the admin panel) didn't include
  // them — so the admin couldn't tell whether a bot's "long-term memory"
  // was actually populated. The field is additive, so an empty array is
  // the right pre-feature default.
  const session = new BotSession({
    id: 'HR-BOT-mem-1', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-mem-1', name: 'Mem-Bot',
    config: cfg(), llm: passLLM, profileId: 'minimax-m2.7', engineBaseUrl: ''
  });
  const ins = session.inspect();
  assert.ok(Array.isArray(ins.phaseSummaries), 'phaseSummaries must be an array on inspect()');
  assert.equal(ins.phaseSummaries.length, 0);
  assert.equal(ins.phaseSummariesCount, 0);
  session.phaseSummaries.push({ phase: 'night', round: 1, summary: 'synthetic test entry', ts: Date.now() });
  assert.equal(session.inspect().phaseSummaries.length, 1);
  assert.equal(session.inspect().phaseSummariesCount, 1);
});

test('BotSession: default (no profileId) resolves to local, costCeilingUsd Infinity, never trips the USD gate', async () => {
  let called = 0;
  const spyLLM = { async generate() { called++; return { kind: 'pass' }; } };
  const session = new BotSession({
    id: 'HR-BOT-local-1', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-local-1', name: 'Local-Bot',
    config: cfg(), llm: spyLLM, engineBaseUrl: ''
  });
  assert.equal(session.profileId, 'local');
  assert.equal(session.costCeilingUsd, Infinity);
  session.alive = true;
  session.costUsd = 1e9; // absurdly large — must still never trip the USD gate
  await session._act({ kind: 'night_action_prompt', round: 2 });
  assert.equal(called, 1, 'the LLM was still invoked — the USD gate never fired for local');
  assert.notEqual(session.lastAction, 'budget_exhausted');
  await session.close();
});

test('BotSession: USD budget gate fires at costCeilingUsd and short-circuits before calling the LLM', async () => {
  let called = 0;
  const spyLLM = { async generate() { called++; return { kind: 'pass' }; } };
  const session = new BotSession({
    id: 'HR-BOT-cost-b', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-cost-b', name: 'Cost-Bot',
    config: cfg(), llm: spyLLM, profileId: 'minimax-m2.7', costCeilingUsd: 0.01, engineBaseUrl: ''
  });
  session.alive = true;
  session.costUsd = 0.01; // at the ceiling
  let reason;
  const detailSpy = (prompt, status, detail) => { reason = detail?.reason; };
  const origMark = session._markRoundAction.bind(session);
  session._markRoundAction = (prompt, status, detail) => { detailSpy(prompt, status, detail); origMark(prompt, status, detail); };
  await session._act({ kind: 'night_action_prompt', round: 2 });
  assert.equal(called, 0, 'the LLM must not be called once the USD ceiling is reached');
  assert.equal(session.lastAction, 'budget_exhausted');
  assert.equal(reason, 'budget_exhausted_usd', 'the reason distinguishes USD exhaustion from token exhaustion');
  await session.close();
});

test('BotSession: token budget gate still reports its own distinct reason', async () => {
  let called = 0;
  const spyLLM = { async generate() { called++; return { kind: 'pass' }; } };
  const session = new BotSession({
    id: 'HR-BOT-cost-c', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-cost-c', name: 'Cost-Bot',
    config: cfg(), llm: spyLLM, engineBaseUrl: ''
  });
  session.alive = true;
  session.costCeiling = 1;
  session.tokensUsed = 100; // over the token ceiling, USD ceiling untouched (Infinity for local)
  let reason;
  const origMark = session._markRoundAction.bind(session);
  session._markRoundAction = (prompt, status, detail) => { reason = detail?.reason; origMark(prompt, status, detail); };
  await session._act({ kind: 'night_action_prompt', round: 2 });
  assert.equal(called, 0);
  assert.equal(session.lastAction, 'budget_exhausted');
  assert.equal(reason, 'budget_exhausted_tokens');
  await session.close();
});

test('BotSession: a per-spawn costCeilingUsd override is honoured the same way costCeiling is', () => {
  const session = new BotSession({
    id: 'HR-BOT-cost-d', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-cost-d', name: 'Cost-Bot',
    config: cfg(), llm: passLLM, profileId: 'minimax-m2.7', costCeilingUsd: 1.23, engineBaseUrl: ''
  });
  assert.equal(session.costCeilingUsd, 1.23);
});

test('BotSession: snapshot() round-trips profile, costUsd and reasoningTokens through restore', async () => {
  const session = new BotSession({
    id: 'HR-BOT-snap-1', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-snap-1', name: 'Snap-Bot',
    config: cfg(), llm: passLLM, profileId: 'minimax-m2.7', engineBaseUrl: ''
  });
  session.costUsd = 0.1234;
  session.reasoningTokens = 42;
  const snap = session.snapshot();
  assert.equal(snap.profile, 'minimax-m2.7');
  assert.equal(snap.costUsd, 0.1234);
  assert.equal(snap.reasoningTokens, 42);

  const restored = new BotSession({
    id: 'HR-BOT-snap-1', config: cfg(), llm: passLLM, engineBaseUrl: '', snapshot: snap
  });
  assert.equal(restored.profileId, 'minimax-m2.7');
  assert.equal(restored._profile, PROFILES['minimax-m2.7']);
  assert.equal(restored.costUsd, 0.1234);
  assert.equal(restored.reasoningTokens, 42);

  await session.close();
  await restored.close();
});

test('BotSession: restoring a snapshot with no profile field falls back to local (pre-profile snapshot compat)', async () => {
  const legacySnap = {
    id: 'HR-BOT-legacy', role: 'interrogator', alive: true, phase: 'night', round: 2,
    costCeiling: 200000, tokensUsed: 0, lastAction: 'restored', startedAt: Date.now()
    // no `profile`, `costUsd`, `reasoningTokens` — matches a snapshot written before this feature
  };
  const restored = new BotSession({ id: 'HR-BOT-legacy', config: cfg(), llm: passLLM, engineBaseUrl: '', snapshot: legacySnap });
  assert.equal(restored.profileId, 'local');
  assert.equal(restored.costUsd, 0);
  assert.equal(restored.reasoningTokens, 0);
  await restored.close();
});
