import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSession } from '../src/session.js';

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
