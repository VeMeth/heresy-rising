import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionLLM } from '../src/llm/actionLLM.js';
import { MockChatLLM } from '../src/llm/mockChatLLM.js';
import { BotSession } from '../src/session.js';
import { ConversationDirector } from '../src/director.js';
import { readThoughts, _resetThoughtsForTests } from '../src/thoughts.js';

// Covers BOT_THOUGHTS_FEED_PLAN.md §6 items 6/7/8 (actionLLM 'thinking'
// capture) plus the session.js _logAction mirroring and director.js speak
// capture from §2.2 items 2/3.

test.beforeEach(() => {
  _resetThoughtsForTests();
});

// --- actionLLM.js: 'thinking' capture (plan §6.6-6.8) ---------------------

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
    shortTermMemory: { items: [] },
    notes: { size: 0, all: () => ({}) },
    tokensUsed: 0,
    ...overrides
  };
}

test('actionLLM: a MiniMax-shaped response with reasoningText produces a thinking entry containing it', async () => {
  const chat = {
    async chat() {
      return {
        content: '{"kind":"pass"}',
        usage: {},
        reasoningText: 'I should pass this round because no strong lead has emerged yet.'
      };
    }
  };
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: { kind: 'day_vote_prompt' } });

  const { entries } = readThoughts({ kinds: ['thinking'] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].thought, 'I should pass this round because no strong lead has emerged yet.');
  assert.equal(entries[0].conclaveCode, 'CONCL1');
  assert.equal(entries[0].detail.parsed, true);
  assert.equal(entries[0].detail.actionKind, 'pass');
  assert.equal(entries[0].detail.attempt, 1);
});

test('actionLLM: a local-shaped inline <think> response also produces a thinking entry with the stripped reasoning', async () => {
  const chat = new MockChatLLM(['<think>I should vote P-04, this seems clear</think>{"kind":"vote","target":"P-04"}']);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });

  const { entries } = readThoughts({ kinds: ['thinking'] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].thought, 'I should vote P-04, this seems clear');
  assert.equal(entries[0].detail.parsed, true);
  assert.equal(entries[0].detail.actionKind, 'vote');
});

test('actionLLM: a parse failure followed by a nudge retry produces TWO thinking entries', async () => {
  const chat = new MockChatLLM([
    'Just chit-chatting, no JSON at all.',
    '{"kind":"vote","target":"P-04","justification":"strange story"}'
  ]);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: fakeSession(), prompt: { kind: 'day_vote_prompt' } });
  assert.equal(action.kind, 'vote');

  const { entries } = readThoughts({ kinds: ['thinking'] });
  assert.equal(entries.length, 2, 'one thinking entry per attempt');
  assert.equal(entries[0].detail.attempt, 1);
  assert.equal(entries[0].detail.parsed, false);
  assert.equal(entries[1].detail.attempt, 2);
  assert.equal(entries[1].detail.parsed, true);
});

test('actionLLM: no reasoningText and no <think> block leaves thought null, but still records the entry', async () => {
  const chat = new MockChatLLM(['{"kind":"pass"}']);
  const a = new ActionLLM({ chatModel: chat });
  await a.generate({ session: fakeSession(), prompt: {} });
  const { entries } = readThoughts({ kinds: ['thinking'] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].thought, null);
});

test('actionLLM: sessionless/minimal fixture path (bare fake session) does not throw and still records', async () => {
  const chat = new MockChatLLM(['{"kind":"pass"}']);
  const a = new ActionLLM({ chatModel: chat });
  const action = await a.generate({ session: {}, prompt: {} });
  assert.equal(action.kind, 'pass');
  const { entries } = readThoughts({ kinds: ['thinking'] });
  assert.equal(entries.length, 1);
});

// --- session.js: _logAction mirroring (plan §2.2 item 2) ------------------

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

function makeSession({ chatScripts = [], role = 'imperial-citizen', faction = 'loyalist' } = {}) {
  const chat = new MockChatLLM(chatScripts);
  const llm = new ActionLLM({ chatModel: chat, maxRetries: 1 });
  const session = new BotSession({
    id: 'HR-BOT-deadbeef1234',
    conclaveCode: 'CONCL1',
    playerCode: 'HR-BOT-deadbeef1234',
    name: 'Cogitator-1',
    personaOverrides: null,
    config: cfg({ botActionDelayMs: 0 }),
    llm,
    engineBaseUrl: '' // skip real socket connect
  });
  session.role = role;
  session.faction = faction;
  session.phase = 'night';
  session.round = 2;
  session.alive = true;
  session.alivePlayers = ['HR-BOT-deadbeef1234', 'human-p1', 'human-p2', 'human-p3'];
  session._latestMe = { crippleTier: 0 };

  const emitted = [];
  session._socket = {
    connected: true,
    timeout() {
      return {
        emit(event, payload, cb) {
          emitted.push({ event, payload });
          if (typeof cb === 'function') cb({ ok: true });
        }
      };
    },
    disconnect() {}
  };
  return { session, emitted };
}

test('_logAction mirroring: a validator rejection produces a "rejected" feed entry', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"interrogate","tier":1,"target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'interrogator' });
  session._latestMe.crippleTier = 2; // triggers the soft-reject path
  await session._act({ kind: 'night_action_prompt', round: 3 });
  assert.equal(emitted.length, 0);

  const { entries } = readThoughts({ botId: session.id, kinds: ['rejected'] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].summary, /rejected/i);
  await session.close();
});

test('_logAction mirroring: a suppressed near-duplicate chat produces a "suppressed" feed entry', async () => {
  const repeatedText = 'I think the killer struck again last night unfortunately';
  const scripts = [`\`\`\`action\n{"kind":"chat","text":"${repeatedText}"}\n\`\`\``];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day';
  // Seed the bot's own history with the exact same line so the near-duplicate
  // guard in _act() fires (see session.js's isNearDuplicate check).
  session.actionLog.push({ kind: 'chat', text: repeatedText });

  await session.takeChatTurn('reactive');
  assert.equal(emitted.length, 0, 'the duplicate chat must never reach the socket');

  const { entries } = readThoughts({ botId: session.id, kinds: ['suppressed'] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].summary, /suppressed near-duplicate chat/i);
  await session.close();
});

test('_logAction mirroring: a plain accepted vote produces an "action" feed entry, not "error" or "rejected"', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1","justification":"seems suspicious"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day'; session.round = 2;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });
  assert.ok(emitted.find((e) => e.event === 'vote:submit'));

  const { entries } = readThoughts({ botId: session.id, kinds: ['action'] });
  assert.ok(entries.some((e) => /voted human-p1/.test(e.summary)));
  await session.close();
});

test('_logAction mirroring: llm.generate() throwing maps to an "error" feed entry (llm_error)', async () => {
  // Note: ActionLLM itself swallows a failing chat() call internally and
  // resolves to {kind:'pass'} (see sim-mocked.test.js's "weathering LLM
  // errors" case) — the session-level llm_error path only fires when the
  // `llm` object passed to BotSession throws out of generate() entirely.
  const throwingLlm = { async generate() { throw new Error('boom'); } };
  const session = new BotSession({
    id: 'HR-BOT-deadbeef9999', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-deadbeef9999',
    name: 'Cogitator-2', config: cfg({ botActionDelayMs: 0 }), llm: throwingLlm, engineBaseUrl: ''
  });
  session.role = 'imperial-citizen'; session.phase = 'day'; session.round = 2; session.alive = true;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });

  const { entries } = readThoughts({ botId: session.id, kinds: ['error'] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].summary, /error/i);
  await session.close();
});

test('_logAction mirroring: a disconnected socket at dispatch time maps to an "error" feed entry (socket_offline)', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1","justification":"seems suspicious"}\n```'];
  const { session } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day'; session.round = 2;
  session._socket.connected = false;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });

  const { entries } = readThoughts({ botId: session.id, kinds: ['error'] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].summary, /error/i);
  await session.close();
});

// --- director.js: 'director' capture on speak, not on a no-op tick (plan §2.2 item 3) ---

function fakeDirectorSession(playerCode, { alive = true } = {}) {
  return {
    playerCode, id: playerCode, name: playerCode, alive,
    conclaveCode: 'C1',
    _chatSentThisPhase: 0,
    async takeChatTurn() { this._chatSentThisPhase++; }
  };
}

function makeDirector(overrides = {}) {
  let clock = 0;
  const config = { directorTickMs: 4000, botMinChatGapMs: 25000, botChatPerPhaseMax: 3, botIntroGapMs: 12000, ...overrides };
  const d = new ConversationDirector({ conclaveCode: 'C1', config, now: () => clock, autoTick: false });
  return { d, advance: (ms) => { clock += ms; } };
}

test('director: a no-op tick (nothing to say) records no director entry', async () => {
  const { d } = makeDirector();
  const bob = fakeDirectorSession('bob');
  d.registerBot(bob);
  d._botState.get('bob').introduced = true; // isolate reactive scoring from intro logic
  d.onPhaseChange('day');
  await d._tick();

  const { entries } = readThoughts({ kinds: ['director'] });
  assert.equal(entries.length, 0);
});

test('director: an actual speak decision (Day-1 intro) records exactly one director entry', async () => {
  const { d } = makeDirector({ botIntroGapMs: 1000 });
  const alice = fakeDirectorSession('alice');
  d.registerBot(alice);
  d.onPhaseChange('day');
  await d._tick();

  const { entries } = readThoughts({ kinds: ['director'] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].botId, 'alice');
  assert.match(entries[0].summary, /introduce yourself on Day 1/);
});

// The re-vote and out-of-turn guards are the other two places _act() blocks
// something the model actually produced. They must read as suppressions, not
// as the bot choosing silence — otherwise the feed hides the difference
// between "said nothing" and "tried to act and we stopped it".
test('_logAction mirroring: a re-vote for the same target is "suppressed", not a plain pass', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1","justification":"still suspicious"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day'; session.round = 2;
  session._lastVoteTarget = 'human-p1'; // already voted this target this round

  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });
  assert.equal(emitted.filter((e) => e.event === 'vote:submit').length, 0, 'the duplicate vote must not reach the socket');

  const { entries } = readThoughts({ botId: session.id, kinds: ['suppressed'] });
  assert.equal(entries.length, 1, 'expected exactly one suppression entry');
  assert.match(entries[0].summary, /already voted/i);
  await session.close();
});

test('_logAction mirroring: a chat turn that emits a vote is "suppressed"', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1","justification":"out of turn"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day'; session.round = 2;

  await session.takeChatTurn('reactive');
  assert.equal(emitted.filter((e) => e.event === 'vote:submit').length, 0, 'a chat turn must never cast a vote');

  const { entries } = readThoughts({ botId: session.id, kinds: ['suppressed'] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].summary, /chat_turn cannot emit vote/i);
  await session.close();
});
