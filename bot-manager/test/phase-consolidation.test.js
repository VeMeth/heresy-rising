import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationDirector } from '../src/director.js';
import { ActionLLM } from '../src/llm/actionLLM.js';
import { MockChatLLM } from '../src/llm/mockChatLLM.js';
import { _resetQueueForTests } from '../src/llm/queue.js';
import { RollingSummary } from '../src/memory.js';

// A session stub that has only the surface the director's consolidation
// path actually touches. Cheaper than spinning up a real BotSession — the
// real one is exercised by the simulator tests. Exposes the in-flight
// consolidation via `_pendingConsolidation` so tests can `await` it
// instead of polling on `phaseSummaries.length`.
function fakeSession(playerCode, { consolidate = true, summaryLines = [] } = {}) {
  const rolling = new RollingSummary();
  for (const line of summaryLines) rolling._push(line);
  const session = {
    playerCode,
    id: playerCode,
    name: playerCode,
    alive: true,
    tokensUsed: 0,
    costUsd: 0,
    costCeiling: 1000000,
    costCeilingUsd: Infinity,
    rollingSummary: rolling,
    phaseSummaries: [],
    _closing: false,
    _save: () => {},
    _pendingConsolidation: null,
    _profile: consolidate ? { consolidateAtPhaseEnd: true, lane: 'cloud', usdPerMTokIn: 0, usdPerMTokOut: 0 } : { consolidateAtPhaseEnd: false, lane: 'local' },
    _llm: null,
    async consolidatePhase(prevPhase, prevRound, events) {
      if (!this._profile?.consolidateAtPhaseEnd) return;
      if (!events.length) return;
      if (this.tokensUsed >= this.costCeiling) return;
      if (this.costUsd >= this.costCeilingUsd) return;
      const task = (async () => {
        const result = await this._llm.consolidate({ session: this, phase: prevPhase, round: prevRound, events });
        if (result?.summary) {
          this.phaseSummaries.push({ phase: prevPhase, round: prevRound, summary: result.summary, ts: Date.now() });
        }
      })();
      this._pendingConsolidation = task;
      return task;
    }
  };
  return session;
}

function makeDirector({ jitterMs = 0 } = {}) {
  let clock = 0;
  const config = {
    directorTickMs: 50,
    botConsolidationJitterMs: jitterMs,
    botQueueBackpressureThreshold: 2
  };
  const d = new ConversationDirector({ conclaveCode: 'C1', config, now: () => clock, autoTick: false });
  return { d, advance: (ms) => { clock += ms; } };
}

test('phase-consolidation: phase change schedules one consolidation per bot per transition', () => {
  const { d } = makeDirector({ jitterMs: 0 });
  const a = fakeSession('a', { summaryLines: ['[R1] lynched someone'] });
  const b = fakeSession('b', { summaryLines: ['[R1] voted'] });
  d.registerBot(a);
  d.registerBot(b);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 2, 'both cloud bots scheduled');
  assert.deepEqual(d._consolidationQueue.map((e) => e.playerCode).sort(), ['a', 'b']);
  assert.equal(d._consolidationQueue[0].prevPhase, 'night');
  assert.equal(d._consolidationQueue[0].prevRound, 1);
});

test('phase-consolidation: local bot (consolidateAtPhaseEnd=false) is not scheduled', () => {
  const { d } = makeDirector({ jitterMs: 0 });
  const local = fakeSession('local', { consolidate: false, summaryLines: ['[R1] chat'] });
  const cloud = fakeSession('cloud', { summaryLines: ['[R1] chat'] });
  d.registerBot(local);
  d.registerBot(cloud);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 1);
  assert.equal(d._consolidationQueue[0].playerCode, 'cloud');
});

test('phase-consolidation: bot with empty rolling summary is skipped at scheduling time', () => {
  const { d } = makeDirector({ jitterMs: 0 });
  const empty = fakeSession('empty', { summaryLines: [] });
  const busy = fakeSession('busy', { summaryLines: ['[R1] kill'] });
  d.registerBot(empty);
  d.registerBot(busy);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 1);
  assert.equal(d._consolidationQueue[0].playerCode, 'busy');
});

test('phase-consolidation: tick drains one queued entry per pass via session.consolidatePhase', async () => {
  _resetQueueForTests();
  const mockChat = new MockChatLLM(['{"summary": "A-1 was lynched. B-2 accused C-3."}']);
  const llm = new ActionLLM({ chatModel: mockChat });
  const { d, advance } = makeDirector({ jitterMs: 0 });
  const bot = fakeSession('bot', { summaryLines: ['[R1] lynched someone'] });
  bot._llm = llm;
  d.registerBot(bot);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 1);
  await d._tick();
  await bot._pendingConsolidation;
  assert.equal(bot.phaseSummaries.length, 1, 'summary was appended');
  assert.equal(bot.phaseSummaries[0].phase, 'night');
  assert.equal(bot.phaseSummaries[0].round, 1);
  assert.match(bot.phaseSummaries[0].summary, /A-1 was lynched/);
  assert.equal(d._consolidationQueue.length, 0, 'queue drained after firing');
});

test('phase-consolidation: a random jitter spreads 5 bots across the queue, not all at once', () => {
  const { d } = makeDirector({ jitterMs: 5000 });
  const bots = [];
  for (let i = 0; i < 5; i++) {
    const bot = fakeSession(`bot-${i}`, { summaryLines: [`[R1] event ${i}`] });
    d.registerBot(bot);
    bots.push(bot);
  }
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 5);
  // Not all entered the queue at the same dueAt — the random jitter would
  // need an astronomically bad seed to fail this. If it ever fails,
  // regenerate the seed until the universe conspires again.
  const dueAtSet = new Set(d._consolidationQueue.map((e) => e.dueAt));
  assert.ok(dueAtSet.size >= 4, `at least 4 of 5 dueAt values must differ; got ${dueAtSet.size}`);
});

test('phase-consolidation: unregisterBot drops its pending consolidation', () => {
  const { d } = makeDirector({ jitterMs: 1000 });
  const a = fakeSession('a', { summaryLines: ['line'] });
  const b = fakeSession('b', { summaryLines: ['line'] });
  d.registerBot(a);
  d.registerBot(b);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 2);
  d.unregisterBot('a');
  assert.equal(d._consolidationQueue.length, 1);
  assert.equal(d._consolidationQueue[0].playerCode, 'b');
});

test('phase-consolidation: when a bot disconnects before its queued entry fires, the drain drops the entry rather than throwing', async () => {
  _resetQueueForTests();
  const mockChat = new MockChatLLM(['{"summary": "..."}']);
  const llm = new ActionLLM({ chatModel: mockChat });
  const { d } = makeDirector({ jitterMs: 0 });
  const a = fakeSession('a', { summaryLines: ['line'] });
  a._llm = llm;
  d.registerBot(a);
  d.onPhaseChange('day', 'night', 1);
  assert.equal(d._consolidationQueue.length, 1);
  d.unregisterBot('a'); // gone before the drain fires
  await d._tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(d._consolidationQueue.length, 0, 'stale entry dropped');
  assert.equal(mockChat.calls, 0, 'no LLM call made for a registered-elsewhere bot');
});

test('phase-consolidation: malformed response falls back to raw text rather than storing nothing', async () => {
  _resetQueueForTests();
  const mockChat = new MockChatLLM(['Here is the recap: things happened, then more things.']);
  const llm = new ActionLLM({ chatModel: mockChat });
  const { d } = makeDirector({ jitterMs: 0 });
  const bot = fakeSession('bot', { summaryLines: ['event'] });
  bot._llm = llm;
  d.registerBot(bot);
  d.onPhaseChange('day', 'night', 1);
  await d._tick();
  await bot._pendingConsolidation;
  assert.equal(bot.phaseSummaries.length, 1);
  assert.match(bot.phaseSummaries[0].summary, /things happened/);
});

test('phase-consolidation: prompts include role, faction, phase, round, and the rolling events', async () => {
  _resetQueueForTests();
  const mockChat = new MockChatLLM(['{"summary": "ok"}']);
  const llm = new ActionLLM({ chatModel: mockChat });
  const { d } = makeDirector({ jitterMs: 0 });
  const bot = fakeSession('bot', { summaryLines: ['[R3] alice was lynched'] });
  bot.role = 'interrogator';
  bot.faction = 'loyalist';
  bot._llm = llm;
  d.registerBot(bot);
  d.onPhaseChange('day', 'night', 3);
  await d._tick();
  await bot._pendingConsolidation;
  const sent = mockChat.received[0];
  assert.equal(sent.length, 2, 'system + user');
  assert.match(sent[1].content, /interrogator/);
  assert.match(sent[1].content, /loyalist/);
  assert.match(sent[1].content, /night/);
  assert.match(sent[1].content, /round 3/);
  assert.match(sent[1].content, /alice was lynched/);
});
