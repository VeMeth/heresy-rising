import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSession } from '../src/session.js';

// Build a minimal session for exercising the chat-reply gate. The LLM is
// never actually called — these tests look at whether _chatTimer is armed
// in response to _onChatMessage, not what gets emitted.
function makeChatSession({ id, peerIds = [] }) {
  const session = new BotSession({
    id,
    conclaveCode: 'CONCL1',
    playerCode: id,
    name: id,
    personaOverrides: null,
    config: {
      heresyBotPort: 7878, heresyGameHost: 'mock', botApiKey: 'b', adminApiKey: 'a', simBypassToken: 's',
      miniMaxApiKey: '', miniMaxModel: 'm', miniMaxBaseUrl: 'https://example/v1',
      maxBotSessions: 12, maxBotsPerGame: 4, llmTimeoutMs: 100, llmTemperature: 0.7,
      maxTokens: 512, topP: 0.9, maxTokensPerGame: 50000,
      botActionDelayMs: 0, chatDebounceMs: 10, maxRetries: 1, langChainTracing: false
    },
    llm: { async generate() { return { kind: 'pass' }; } },
    engineBaseUrl: ''
  });
  session.role = 'imperial-citizen';
  session.faction = 'loyalist';
  session.phase = 'day';
  session.round = 2;
  session.alive = true;
  session.alivePlayers = [id, ...peerIds];
  session._latestMe = { crippleTier: 0 };
  // The bot only knows the peer IDs it is meant to recognise as bots —
  // this is what _onChatMessage uses to decide whether a message is a
  // "bot echo chamber" speaker.
  session.botIds = [id, ...peerIds];
  return session;
}

function chatMsg(playerCode, author, body) {
  return { message: { player_code: playerCode, author, body, channel: 'public' } };
}

test('echo-chamber: a bot does not reply when the last 3 chat messages are all from bots', () => {
  const steve = makeChatSession({ id: 'HR-BOT-steve', peerIds: ['HR-BOT-bob'] });

  // Pre-populate: three recent messages, all from bots. Steve's memory now
  // ends in a bot-only streak.
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'two Chirurgeons is suspicious'));
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'we should verify their claims'));
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'still waiting on more info'));

  // A new bot message arrives — but the recent window is already saturated
  // with bot messages, so no reply should be scheduled.
  assert.equal(steve._chatTimer, null, 'no reply armed after bot-only streak');
});

test('echo-chamber: a bot DOES reply when a human has spoken in the recent window', () => {
  const steve = makeChatSession({ id: 'HR-BOT-steve', peerIds: ['HR-BOT-bob'] });

  // Last three messages: human, bot, bot. The streak is broken — Steve
  // is allowed to chime in on the conversation.
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'two Chirurgeons is suspicious'));
  steve._onChatMessage(chatMsg('HR-HUMAN-1', 'Town', 'anyone got info?'));
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'still waiting'));

  // Now a fresh bot message arrives. The window is {bot, human, bot} so
  // the not-all-bots branch passes and the timer should be armed.
  steve._onChatMessage(chatMsg('HR-BOT-bob', 'Bob', 'patience is our best asset'));
  assert.notEqual(steve._chatTimer, null, 'reply armed when human was in recent window');
  clearTimeout(steve._chatTimer);
});

test('echo-chamber: a bot ignores its own chat messages', () => {
  const steve = makeChatSession({ id: 'HR-BOT-steve', peerIds: ['HR-BOT-bob'] });
  steve._onChatMessage(chatMsg('HR-BOT-steve', 'Steve', 'I am a Chirurgeon'));
  assert.equal(steve._chatTimer, null, 'no reply armed to self');
});

test('per-phase cap: a bot stops replying after CHAT_SENT_PER_PHASE_MAX messages', () => {
  const steve = makeChatSession({ id: 'HR-BOT-steve', peerIds: ['HR-BOT-bob'] });

  // Simulate Steve having already sent 2 chat messages this phase (the cap).
  steve._chatSentThisPhase = BotSession.CHAT_SENT_PER_PHASE_MAX;

  // A fresh human message arrives — but Steve has hit his per-phase budget,
  // so no reply is armed.
  steve._onChatMessage(chatMsg('HR-HUMAN-1', 'Town', 'seriously, anyone got info?'));
  assert.equal(steve._chatTimer, null, 'no reply armed after per-phase cap is hit');
});

test('per-phase cap: counter resets when the phase changes', () => {
  const steve = makeChatSession({ id: 'HR-BOT-steve', peerIds: ['HR-BOT-bob'] });
  steve._chatSentThisPhase = BotSession.CHAT_SENT_PER_PHASE_MAX;

  // Walk the session through a phase change (day → night).
  steve._lastPhase = 'day';
  steve.phase = 'night';
  steve._onGameState({ state: { phase: 'night', round: steve.round, players: [], me: steve._latestMe } });

  assert.equal(steve._chatSentThisPhase, 0, 'counter cleared on phase transition');
});
