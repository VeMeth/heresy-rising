import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSession } from '../src/session.js';
import { MockChatLLM } from '../src/llm/mockChatLLM.js';
import { ActionLLM } from '../src/llm/actionLLM.js';

const cfg = (overrides = {}) => ({
  heresyBotPort: 7878,
  heresyGameHost: 'mock',
  botApiKey: 'b',
  adminApiKey: 'a',
  simBypassToken: 's',
  miniMaxApiKey: '',
  miniMaxModel: 'MiniMax-M3',
  miniMaxBaseUrl: 'https://example/v1',
  maxBotSessions: 12,
  maxBotsPerGame: 4,
  llmTimeoutMs: 30,
  llmTemperature: 0.7,
  maxTokens: 512,
  topP: 0.9,
  maxTokensPerGame: 50000,
  botActionDelayMs: 0,
  chatDebounceMs: 0,
  maxRetries: 1,
  langChainTracing: false,
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
    config: cfg({ botActionDelayMs: 0, chatDebounceMs: 0 }),
    llm,
    engineBaseUrl: '' // skip real socket connect
  });
  // Drive state by hand:
  session.role = role;
  session.faction = faction;
  session.phase = 'night';
  session.round = 2;
  session.alive = true;
  session.alivePlayers = ['HR-BOT-deadbeef1234', 'human-p1', 'human-p2', 'human-p3'];
  session._latestMe = { crippleTier: 0 };

  // Stubbed socket: implement timeout().emit() pattern socket.io-client uses.
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
  return { session, emitted, chat };
}

test('sim: bot emits a night action when MockLLM scripts an interrogate block', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"interrogate","tier":2,"target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'interrogator' });
  await session._act({ kind: 'night_action_prompt', round: 2 });
  const action = emitted.find((e) => e.event === 'action:submit');
  assert.ok(action, 'an action:submit was emitted');
  assert.equal(action.payload.targetCode, 'human-p1');
  assert.equal(action.payload.variant, 'T2');
  session._socket.connected = false;
  await session.close();
});

test('sim: Day 1 → bot passes (no vote prompt expected)', async () => {
  const { session } = makeSession({ chatScripts: ['```action\n{"kind":"pass"}\n```'] });
  session.phase = 'day'; session.round = 1;
  await session._act({ kind: 'day_vote_prompt', round: 1, votingEnabled: false });
  assert.equal(session.lastAction, 'pass');
  await session.close();
});

test('sim: Day 2 vote → bot emits vote:submit', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1","justification":"voted strangely"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts });
  session.phase = 'day'; session.round = 2;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true, legalTargets: ['human-p1','human-p2'] });
  const vote = emitted.find((e) => e.event === 'vote:submit');
  assert.ok(vote, 'vote:submit emitted');
  assert.equal(vote.payload.targetCode, 'human-p1');
  assert.match(vote.payload.justification, /strangely/);
  await session.close();
});

test('sim: chat response → chat:send', async () => {
  const scripts = ['I will speak up.\n```action\n{"kind":"chat","text":"I think P-02 is acting oddly."}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts });
  session.phase = 'day'; session.round = 2;
  await session._act({ kind: 'chat_reply' });
  const chatMsg = emitted.find((e) => e.event === 'chat:send');
  assert.ok(chatMsg);
  assert.equal(chatMsg.payload.channel, 'public');
  assert.match(chatMsg.payload.body, /oddly/);
  await session.close();
});

test('sim: dead bot stays quiet even when MockLLM tries to act', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"kill","target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'murderer', faction: 'heretic' });
  session.alive = false;
  await session._act({ kind: 'night_action_prompt', round: 3 });
  assert.equal(emitted.length, 0, 'dead bot emitted nothing');
  assert.equal(session.lastAction, 'init'); // _act early-returned before touching lastAction
  await session.close();
});

test('sim: cripple T2 night action is soft-rejected by validator (no socket emit)', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"interrogate","tier":1,"target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'interrogator' });
  session._latestMe.crippleTier = 2;
  await session._act({ kind: 'night_action_prompt', round: 3 });
  assert.equal(emitted.length, 0, 'crippled bot did not emit');
  assert.match(session.lastAction, /rejected/i);
  await session.close();
});

test('sim: bot notes from action acceptance persist into session.notes', async () => {
  const scripts = ['```action\n{"kind":"pass","notes":{"P-02-suspicion":"voted against me on Day 2"}}\n```'];
  const { session } = makeSession({ chatScripts: scripts });
  await session._act({ kind: 'day_vote_prompt', round: 3 });
  assert.equal(session.notes.get('P-02-suspicion'), 'voted against me on Day 2');
  await session.close();
});

test('sim: malformed LLM response triggers retry-nudge inside the session flow', async () => {
  const scripts = [
    'rambling without an action block',
    '```action\n{"kind":"vote","target":"human-p2","justification":"bad vibes"}\n```'
  ];
  const { session, emitted, chat } = makeSession({ chatScripts: scripts, role: 'imperial-citizen' });
  session.phase = 'day'; session.round = 2;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });
  assert.equal(chat.calls, 2, 'nudge fired one retry');
  const vote = emitted.find((e) => e.event === 'vote:submit');
  assert.ok(vote);
  assert.equal(vote.payload.targetCode, 'human-p2');
  await session.close();
});

test('sim: token budget exhaustion → bot passes', async () => {
  const scripts = ['```action\n{"kind":"vote","target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts });
  session.phase = 'day'; session.round = 2;
  session.costCeiling = 1; // very small budget
  session.tokensUsed = 100;
  await session._act({ kind: 'day_vote_prompt', round: 2, votingEnabled: true });
  assert.equal(emitted.length, 0);
  assert.equal(session.lastAction, 'budget_exhausted');
  await session.close();
});

test('sim: Heretic priest warp-litany against green target is accepted (target zone unknown → defer to engine)', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"sermon","sermonTier":"warp-litany","target":"human-p1"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'heretic-priest', faction: 'heretic' });
  await session._act({ kind: 'night_action_prompt', round: 3 });
  // The validator accepts when zone unknown; the engine would then silently reject below Orange.
  const action = emitted.find((e) => e.event === 'action:submit');
  assert.ok(action);
  assert.equal(action.payload.variant, 'warp-litany');
  await session.close();
});

test('sim: heretic faction block injected only for Heretic bots', async () => {
  // Quick sanity: the session.faction drives the prompt builder via assemble.js.
  const { session } = makeSession({ chatScripts: ['```action\n{"kind":"pass"}\n```'], role: 'murderer', faction: 'heretic' });
  const { assembleMessages } = await import('../src/prompts/assemble.js');
  const m = assembleMessages({ session, prompt: {} });
  assert.ok(m.system.includes('FACTION CHAT'));
  await session.close();
});

test('sim: L4 novice-psychic cannot target self — validator returns reject', async () => {
  const scripts = ['```action\n{"kind":"night_action","verb":"scan_drift","target":"HR-BOT-deadbeef1234"}\n```'];
  const { session, emitted } = makeSession({ chatScripts: scripts, role: 'novice-psychic' });
  await session._act({ kind: 'night_action_prompt', round: 2 });
  assert.equal(emitted.length, 0, 'self-target was rejected, no emit');
  assert.match(session.lastAction, /self-target/i);
  await session.close();
});

test('sim: weathering LLM errors — bot passes silently (per spec default Q-BOT-6)', async () => {
  const failingChat = { async invoke() { throw new Error('boom'); } };
  const failingLlm = new ActionLLM({ chatModel: failingChat, maxRetries: 1 });
  const session = new BotSession({
    id: 'HR-BOT-deadbeef1234', conclaveCode: 'CONCL1', playerCode: 'HR-BOT-deadbeef1234',
    name: 'Cogitator-1', config: cfg({ botActionDelayMs: 0 }), llm: failingLlm, engineBaseUrl: ''
  });
  session.role = 'interrogator'; session.faction = 'loyalist'; session.phase = 'night'; session.round = 2;
  session.alive = true; session.alivePlayers = ['human-p1','human-p2']; session._latestMe = { crippleTier: 0 };
  // Per spec: bot passes the turn on LLM failure (Q-BOT-6 default), and logs.
  await session._act({ kind: 'night_action_prompt', round: 2 });
  assert.equal(session.lastAction, 'pass');
  await session.close();
});