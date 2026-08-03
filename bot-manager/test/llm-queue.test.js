import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSession } from '../src/session.js';
import { enqueueLLMCall, queueDepth, _resetQueueForTests } from '../src/llm/queue.js';
import { config } from '../src/config.js';

// Build a session whose underlying LLM takes a configurable amount of time
// and tracks how many calls are in flight at once. The session queue is
// supposed to serialize those calls — at most one LLM call active at any
// instant, no matter how many sessions race to call _act() in parallel.
function makeTrackedSession({ id, chatScripts = ['```action\n{"kind":"pass"}\n```'], llmDelayMs }) {
  let inFlight = 0;
  let peakInFlight = 0;
  let resolved = 0;

  const trackedLlm = {
    async generate({ prompt }) {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      // Simulate a slow HTTP request to the LLM provider.
      await new Promise((r) => setTimeout(r, llmDelayMs));
      inFlight--;
      resolved++;
      const script = chatScripts.shift() || '```action\n{"kind":"pass"}\n```';
      // _act only cares about action.kind / action.notes, so we hand back a
      // fully-formed action object instead of going through ActionLLM.
      const match = script.match(/```action\n([\s\S]*?)\n```/);
      if (!match) return { kind: 'pass' };
      try { return JSON.parse(match[1]); } catch { return { kind: 'pass' }; }
    }
  };

  const session = new BotSession({
    id,
    conclaveCode: 'CONCL1',
    playerCode: id,
    name: id,
    personaOverrides: null,
    config: {
      heresyBotPort: 7878, heresyGameHost: 'mock', botApiKey: 'b', adminApiKey: 'a', simBypassToken: 's',
      miniMaxApiKey: '', miniMaxModel: 'm', miniMaxBaseUrl: 'https://example/v1',
      maxBotSessions: 12, maxBotsPerGame: 4, llmTimeoutMs: 5000, llmTemperature: 0.7,
      maxTokens: 512, topP: 0.9, maxTokensPerGame: 50000,
      botActionDelayMs: 0, chatDebounceMs: 0, maxRetries: 1, langChainTracing: false
    },
    llm: trackedLlm,
    engineBaseUrl: ''
  });

  // Drive enough state to make _act() reach the LLM call.
  session.role = 'imperial-citizen';
  session.faction = 'loyalist';
  session.phase = 'day';
  session.round = 2;
  session.alive = true;
  session.alivePlayers = [id, 'human-p1', 'human-p2'];
  session._latestMe = { crippleTier: 0 };
  session.botIds = [id];

  // Stubbed socket: just record emits; _act will try to emit a chat / vote
  // depending on the action the LLM returns. We script 'pass' so it doesn't
  // hit the socket at all (and the test focuses purely on LLM-call overlap).
  session._socket = {
    connected: true,
    timeout() {
      return { emit(_e, _p, cb) { if (typeof cb === 'function') cb({ ok: true }); } };
    },
    disconnect() {}
  };

  return {
    session,
    metrics: {
      peak: () => peakInFlight,
      resolved: () => resolved
    }
  };
}

test('stagger: parallel _act calls across multiple sessions are serialized by the LLM queue', async () => {
  const sessions = [
    makeTrackedSession({ id: 'HR-BOT-aaaa', llmDelayMs: 50 }),
    makeTrackedSession({ id: 'HR-BOT-bbbb', llmDelayMs: 50 }),
    makeTrackedSession({ id: 'HR-BOT-cccc', llmDelayMs: 50 }),
    makeTrackedSession({ id: 'HR-BOT-dddd', llmDelayMs: 50 })
  ];

  // Race four _act() calls. Without the queue, all four LLM.generate() calls
  // would be in flight simultaneously.
  await Promise.all(sessions.map(({ session }) => session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true })));

  for (const { session, metrics } of sessions) {
    assert.equal(metrics.resolved(), 1, `${session.id} ran exactly one LLM call`);
    assert.equal(metrics.peak(), 1, `${session.id} never saw another LLM call in flight at the same time`);
    await session.close();
  }
});

test('stagger: an LLM error in one session does not poison the queue for the next', async () => {
  const failing = makeTrackedSession({ id: 'HR-BOT-eeee', llmDelayMs: 10 });
  // Force the LLM to reject by giving it a script that throws inside _act's await.
  failing.session._llm = {
    async generate() { throw new Error('network blip'); }
  };

  const succeeding = makeTrackedSession({ id: 'HR-BOT-ffff', llmDelayMs: 10 });

  await failing.session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });
  // Second call must not get rejected by the first one's failure.
  await succeeding.session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });

  assert.equal(succeeding.metrics.resolved(), 1, 'queue kept moving after a failed call');
  assert.equal(failing.session.lastAction, 'llm_error', 'first session recorded its own error');
  assert.equal(succeeding.session.lastAction, 'pass', 'second session still got its LLM response');

  await failing.session.close();
  await succeeding.session.close();
});

// --- Lane isolation (queue.js's Map<lane, {...}> restructure) ------------
//
// The tests above exercise the module through BotSession, which today only
// ever enqueues on the (default) 'local' lane. The tests below talk to
// enqueueLLMCall()/queueDepth() directly to cover the cross-lane behaviour
// the plan calls for: a slow call in one lane must not delay a call in
// another lane, cloud concurrency must be honoured, rejections must stay
// lane-local, and queueDepth()'s per-lane / no-arg-total contract must hold.

test('queue: lane isolation — a slow cloud call does not delay a local call queued after it', async () => {
  _resetQueueForTests();
  let releaseCloud;
  const cloudGate = new Promise((r) => { releaseCloud = r; });
  const order = [];

  const cloudCall = enqueueLLMCall(async () => { await cloudGate; order.push('cloud'); return 'cloud-done'; }, { lane: 'cloud' });
  const localCall = enqueueLLMCall(async () => { order.push('local'); return 'local-done'; }, { lane: 'local' });

  const localResult = await localCall;
  assert.equal(localResult, 'local-done');
  assert.deepEqual(order, ['local'], 'local call resolved without waiting on the still-blocked cloud call');

  releaseCloud();
  assert.equal(await cloudCall, 'cloud-done');
  assert.deepEqual(order, ['local', 'cloud']);
  _resetQueueForTests();
});

test('queue: lane isolation — a slow local call does not delay a cloud call queued after it', async () => {
  _resetQueueForTests();
  let releaseLocal;
  const localGate = new Promise((r) => { releaseLocal = r; });
  const order = [];

  const localCall = enqueueLLMCall(async () => { await localGate; order.push('local'); return 'local-done'; }, { lane: 'local' });
  const cloudCall = enqueueLLMCall(async () => { order.push('cloud'); return 'cloud-done'; }, { lane: 'cloud' });

  const cloudResult = await cloudCall;
  assert.equal(cloudResult, 'cloud-done');
  assert.deepEqual(order, ['cloud'], 'cloud call resolved without waiting on the still-blocked local call');

  releaseLocal();
  assert.equal(await localCall, 'local-done');
  assert.deepEqual(order, ['cloud', 'local']);
  _resetQueueForTests();
});

// Gated call helper for the concurrency tests below: fn() flips
// startedFlags[i] the instant it actually starts (not when it's merely
// enqueued), and blocks on `gate` until release() is called — so a test can
// assert exactly how many calls a lane let through before any of them finish.
function gatedCall(lane, i, startedFlags) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const promise = enqueueLLMCall(async () => { startedFlags[i] = true; await gate; return i; }, { lane });
  return { promise, release };
}

test('queue: cloud lane honours its concurrency limit — extra calls queue until a slot frees', async () => {
  _resetQueueForTests();
  const limit = config.botCloudConcurrency; // default 3
  const total = limit + 2;
  const startedFlags = new Array(total).fill(false);
  const gated = Array.from({ length: total }, (_, i) => gatedCall('cloud', i, startedFlags));

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(startedFlags.filter(Boolean).length, limit, `exactly ${limit} cloud calls run concurrently`);

  for (let i = 0; i < limit; i++) gated[i].release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(startedFlags.filter(Boolean).length, total, 'freed slots let the rest of the cloud calls start');

  for (let i = limit; i < total; i++) gated[i].release();
  const results = await Promise.all(gated.map((g) => g.promise));
  assert.deepEqual(results.sort((a, b) => a - b), Array.from({ length: total }, (_, i) => i));
  _resetQueueForTests();
});

test('queue: an unrecognized lane name is created on demand with concurrency 1', async () => {
  _resetQueueForTests();
  const startedFlags = [false, false];
  const gated = [gatedCall('experimental', 0, startedFlags), gatedCall('experimental', 1, startedFlags)];

  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(startedFlags, [true, false], 'only the first call in the unknown lane starts');

  gated[0].release();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(startedFlags, [true, true], 'the second starts only once the first settles');

  gated[1].release();
  await Promise.all(gated.map((g) => g.promise));
  _resetQueueForTests();
});

test('queue: a rejected call in one lane does not block subsequent calls in the same lane', async () => {
  _resetQueueForTests();
  const failing = enqueueLLMCall(async () => { throw new Error('cloud blip'); }, { lane: 'cloud' });
  const succeeding = enqueueLLMCall(async () => 'ok', { lane: 'cloud' });

  await assert.rejects(failing, /cloud blip/);
  assert.equal(await succeeding, 'ok', 'the cloud lane kept moving after a failed call');
  _resetQueueForTests();
});

test('queue: rejections in one lane are invisible to a different lane', async () => {
  _resetQueueForTests();
  const failing = enqueueLLMCall(async () => { throw new Error('local blip'); }, { lane: 'local' });
  const cloudOk = enqueueLLMCall(async () => 'cloud-ok', { lane: 'cloud' });

  await assert.rejects(failing, /local blip/);
  assert.equal(await cloudOk, 'cloud-ok');
  _resetQueueForTests();
});

test('queue: queueDepth() with no argument sums across lanes; per-lane args isolate', async () => {
  _resetQueueForTests();
  assert.equal(queueDepth(), 0, 'starts at zero after reset');
  assert.equal(queueDepth('local'), 0);
  assert.equal(queueDepth('cloud'), 0, 'querying a lane that has never been used does not create it or lie about its depth');

  let releaseLocal, releaseCloud;
  const localGate = new Promise((r) => { releaseLocal = r; });
  const cloudGate = new Promise((r) => { releaseCloud = r; });
  const localP = enqueueLLMCall(() => localGate, { lane: 'local' });
  const cloudP = enqueueLLMCall(() => cloudGate, { lane: 'cloud' });

  assert.equal(queueDepth('local'), 1);
  assert.equal(queueDepth('cloud'), 1);
  assert.equal(queueDepth(), 2, 'no-arg queueDepth sums across all lanes (back-compat with the pre-lanes API)');

  releaseLocal();
  releaseCloud();
  await Promise.all([localP, cloudP]);
  assert.equal(queueDepth(), 0);
  _resetQueueForTests();
});
