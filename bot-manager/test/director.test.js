import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationDirector } from '../src/director.js';
import { enqueueLLMCall, _resetQueueForTests } from '../src/llm/queue.js';

function fakeSession(playerCode, { alive = true } = {}) {
  const calls = [];
  return {
    playerCode, id: playerCode, name: playerCode, alive,
    _chatSentThisPhase: 0,
    async takeChatTurn(reason) { calls.push(reason); this._chatSentThisPhase++; },
    _calls: calls
  };
}

function makeDirector(overrides = {}) {
  let clock = 0;
  const config = { directorTickMs: 4000, botMinChatGapMs: 25000, botChatPerPhaseMax: 3, botIntroGapMs: 12000, ...overrides };
  const d = new ConversationDirector({ conclaveCode: 'C1', config, now: () => clock, autoTick: false });
  return { d, advance: (ms) => { clock += ms; }, now: () => clock };
}

test('director: silence is the default with no input', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true; // isolate reactive-scoring behavior from intro logic
  d.onPhaseChange('day');
  await d._tick();
  assert.equal(bob._calls.length, 0);
});

test('director: staggered Day-1 intros — one per BOT_INTRO_GAP_MS, all bots eventually introduced', async () => {
  const { d, advance } = makeDirector({ botIntroGapMs: 1000 });
  const bots = ['a', 'b', 'c'].map((id) => fakeSession(id));
  for (const b of bots) d.registerBot(b);
  d.onPhaseChange('day');
  for (let i = 0; i < 4; i++) {
    await d._tick();
    advance(1000);
  }
  const introduced = bots.filter((b) => b._calls.length > 0).length;
  assert.equal(introduced, 3, 'all three bots got a staggered introduction');
  assert.ok(bots.every((b) => b._calls[0] === 'introduce yourself on Day 1'));
});

test('director: introductions are staggered, not simultaneous', async () => {
  const { d, advance } = makeDirector({ botIntroGapMs: 5000 });
  const bots = ['a', 'b'].map((id) => fakeSession(id));
  for (const b of bots) d.registerBot(b);
  d.onPhaseChange('day');
  await d._tick(); // first bot introduces
  const introducedAfterFirstTick = bots.filter((b) => b._calls.length > 0).length;
  assert.equal(introducedAfterFirstTick, 1, 'only one bot introduces per tick even with two pending');
  advance(1000);
  await d._tick(); // gap not yet elapsed
  assert.equal(bots.filter((b) => b._calls.length > 0).length, 1, 'second bot waits for the intro gap');
  advance(5000);
  await d._tick();
  assert.equal(bots.filter((b) => b._calls.length > 0).length, 2, 'second bot introduces once the gap elapses');
});

test('director: a bot never replies to its own newest message', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'bob', author: 'bob', isBot: true, text: 'hello', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0, 'no self-reply');
});

test('director: echo guard — three bot-only messages in a row silence the director', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'other-bot', author: 'x', isBot: true, text: 'a', round: 2 });
  d.observe({ id: 2, from: 'other-bot', author: 'x', isBot: true, text: 'b', round: 2 });
  d.observe({ id: 3, from: 'other-bot', author: 'x', isBot: true, text: 'c', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0, 'echo chamber suppressed');
});

test('director: a human message scores above threshold and triggers exactly one reply', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'anyone got info?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 1);
  assert.equal(bob._calls[0], 'reactive');
});

test('director: a human message naming the bot scores higher (name-mention weight)', async () => {
  const { d } = makeDirector();
  const alice = fakeSession('Alice');
  d.registerBot(alice);
  d.onPhaseChange('day');
  d._botState.get('Alice').introduced = true;
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'Alice, what do you think?', round: 2 });
  const score = d._score(alice, d._botState.get('Alice'));
  assert.ok(score >= 3 * d._botState.get('Alice').talkativeness, 'name-mention scores at least the +3 weight');
});

test('director: per-phase cap stops further replies once BOT_CHAT_PER_PHASE_MAX is hit', async () => {
  const { d } = makeDirector({ botChatPerPhaseMax: 1 });
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  bob._chatSentThisPhase = 1; // already at cap
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0, 'capped bot does not speak again');
});

test('director: min chat gap blocks a bot that just spoke', async () => {
  const { d, advance } = makeDirector({ botMinChatGapMs: 10000 });
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d._botState.get('bob').lastSpokeAt = 0;
  advance(5000); // still inside the 10s gap
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0, 'bot within its min-gap window stays silent');
});

test('director: backpressure — high LLM queue depth skips the tick', async () => {
  _resetQueueForTests();
  let release;
  const blocker = new Promise((r) => { release = r; });
  enqueueLLMCall(() => blocker);
  enqueueLLMCall(() => blocker);
  enqueueLLMCall(() => blocker); // depth 3, over the >2 threshold

  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0, 'tick skipped under backpressure');
  release();
  await new Promise((r) => setTimeout(r, 0));
  _resetQueueForTests();
});

test('director: staleness re-check aborts a stale speak (bot died between scoring and dequeue)', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  bob.alive = false; // dies before the tick resolves the pick
  await d._tick();
  assert.equal(bob._calls.length, 0, 'dead bot does not speak');
});

test('director: only one turn in flight at a time — a second tick while speaking is a no-op', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  let resolveSpeak;
  bob.takeChatTurn = () => new Promise((r) => { resolveSpeak = r; });
  d.registerBot(bob);
  d._botState.get('bob').introduced = true;
  d.onPhaseChange('day');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  const firstTick = d._tick(); // enters _speak(), which is now awaiting resolveSpeak
  await Promise.resolve();
  await d._tick(); // should bail immediately — _turnInFlight is true
  assert.equal(d._turnInFlight, true);
  resolveSpeak();
  await firstTick;
  assert.equal(d._turnInFlight, false);
});

test('director: night phase never ticks (public chat is night-closed)', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d.onPhaseChange('night');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0);
});

test('director: unregisterBot removes it from scoring and any pending intro queue', async () => {
  const { d } = makeDirector();
  const bob = fakeSession('bob');
  d.registerBot(bob);
  d.onPhaseChange('day');
  d.unregisterBot('bob');
  d.observe({ id: 1, from: 'human-1', author: 'Human', isBot: false, text: 'hello?', round: 2 });
  await d._tick();
  assert.equal(bob._calls.length, 0);
  assert.equal(d.hasBots(), false);
});
