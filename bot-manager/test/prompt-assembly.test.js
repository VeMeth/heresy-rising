import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleMessages } from '../src/prompts/assemble.js';
import { STATIC_RULES } from '../src/prompts/staticRules.js';
import { roleBlock } from '../src/prompts/roleBlocks.js';
import { estimateTokens } from '../src/prompts/budget.js';
import { RollingSummary } from '../src/memory.js';

function fakeSession(overrides = {}) {
  return {
    role: 'interrogator',
    faction: 'loyalist',
    phase: 'day',
    round: 2,
    alive: true,
    playerCode: 'HR-BOT-deadbeef',
    conclaveCode: 'CONCL1',
    botIds: ['HR-BOT-deadbeef'],
    alivePlayers: ['HR-BOT-deadbeef', 'human-1', 'human-2'],
    deadPlayers: [],
    lastOwnZone: 'green',
    shortTermMemory: { items: [{ kind: 'chat_message', from: 'human-1', author: 'Alice', text: 'I suspect nobody.', round: 2 }] },
    notes: { size: 0, all: () => ({}) },
    rollingSummary: new RollingSummary(),
    personaOverrides: null,
    talkativeness: 0.6,
    _config: {},
    ...overrides
  };
}

test('prompt-assembly: returns exactly {system, user} — no separate history array', () => {
  const out = assembleMessages({ session: fakeSession(), prompt: { kind: 'chat_turn' } });
  assert.equal(typeof out.system, 'string');
  assert.equal(typeof out.user, 'string');
  assert.equal(out.history, undefined);
});

test('prompt-assembly: system block is byte-stable regardless of the volatile prompt/chat history', () => {
  const a = assembleMessages({ session: fakeSession(), prompt: { kind: 'chat_turn' } }).system;
  const b = assembleMessages({ session: fakeSession(), prompt: { kind: 'night_action_prompt' } }).system;
  assert.equal(a, b);
});

test('prompt-assembly: system block contains static rules and role block', () => {
  const { system } = assembleMessages({ session: fakeSession(), prompt: {} });
  assert.ok(system.includes(STATIC_RULES.slice(0, 40)));
  assert.ok(system.includes('YOUR ROLE: INTERROGATOR'));
});

test('prompt-assembly: system block never carries chat history (that lives in `user`, exactly once)', () => {
  const { system, user } = assembleMessages({ session: fakeSession(), prompt: {} });
  assert.ok(!system.includes('I suspect nobody'), 'chat text must not leak into the cached system block');
  assert.ok(user.includes('I suspect nobody'), 'chat text appears in the volatile user block');
});

test('prompt-assembly: heretic faction block only appears when BOT_FACTION_CHAT is enabled', () => {
  const offByDefault = assembleMessages({ session: fakeSession({ role: 'murderer', faction: 'heretic' }), prompt: {} });
  assert.ok(!offByDefault.system.includes('FACTION CHAT'), 'faction chat block suppressed by default');
  const on = assembleMessages({ session: fakeSession({ role: 'murderer', faction: 'heretic', _config: { botFactionChat: true } }), prompt: {} });
  assert.ok(on.system.includes('FACTION CHAT'));
});

test('prompt-assembly: persona overrides + talkativeness descriptor appear when provided', () => {
  const { system } = assembleMessages({
    session: fakeSession({ personaOverrides: 'speak in clipped, terse sentences', talkativeness: 0.8 }),
    prompt: {}
  });
  assert.ok(system.includes('PERSONA OVERRIDES'));
  assert.ok(system.includes('clipped, terse'));
  assert.match(system, /chatty/i);
});

test('prompt-assembly: no role block emitted when session.role is null (lobby)', () => {
  const { system } = assembleMessages({ session: fakeSession({ role: null, phase: 'lobby', round: 0 }), prompt: {} });
  assert.ok(!system.includes('YOUR ROLE: INTERROGATOR'));
  assert.ok(system.includes('Role not yet assigned'));
});

test('prompt-assembly: user message includes state digest, notes, recent chat, and a turn instruction', () => {
  const session = fakeSession();
  session.notes = { size: 1, all: () => ({ 'human-1-suspicion': 'voted oddly' }) };
  const { user } = assembleMessages({ session, prompt: { kind: 'day_vote_prompt', legalTargets: ['human-1', 'human-2'] } });
  assert.match(user, /Round 2/);
  assert.match(user, /human-1-suspicion/);
  assert.match(user, /Alice/);
  assert.match(user, /VOTE/);
});

test('prompt-assembly: bot identity is never leaked into the prompt (Q-BOT-9 — bots must be indistinguishable from humans in chat, and this is weak against prompt injection from public chat)', () => {
  const { system, user } = assembleMessages({
    session: fakeSession({ botIds: ['HR-BOT-deadbeef', 'HR-BOT-cafe-0001'] }),
    prompt: {}
  });
  assert.ok(!user.includes('Other bots at the table'));
  assert.ok(!user.includes('HR-BOT-cafe-0001'));
  assert.ok(!system.includes('HR-BOT-cafe-0001'));
});

test('prompt-assembly: recent chat is rendered once, newest last, own messages marked (you)', () => {
  const session = fakeSession({
    shortTermMemory: { items: [
      { kind: 'chat_message', from: 'human-1', author: 'Alice', text: 'first' },
      { kind: 'chat_message', from: 'HR-BOT-deadbeef', author: 'Cogitator-1', text: 'my own reply' }
    ] }
  });
  const { user } = assembleMessages({ session, prompt: {} });
  const firstIdx = user.indexOf('first');
  const ownIdx = user.indexOf('my own reply');
  assert.ok(firstIdx !== -1 && ownIdx !== -1 && firstIdx < ownIdx, 'newest message renders last');
  assert.match(user, /\(you\)/);
});

test('prompt-assembly: recent chat evicts oldest first but always keeps at least 6 when available', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push({ kind: 'chat_message', from: `p-${i}`, author: `P${i}`, text: `message number ${i} `.repeat(20) });
  const session = fakeSession({ shortTermMemory: { items } });
  const { user } = assembleMessages({ session, prompt: {} });
  assert.ok(!user.includes('message number 0 '), 'oldest evicted first');
  assert.ok(user.includes('message number 39'), 'newest always survives');
  let keptCount = 0;
  for (let i = 0; i < 40; i++) if (user.includes(`message number ${i} `)) keptCount++;
  assert.ok(keptCount >= 6, `at least 6 recent chat lines are always kept even under budget pressure (kept ${keptCount})`);
});

test('prompt-assembly: rolling summary text is included in the user message', () => {
  const summary = new RollingSummary();
  summary.addAnnouncement({ type: 'lynch', title: 'SENTENCE EXECUTED', message: 'P-02 was lynched and revealed heretic.' }, 3);
  const { user } = assembleMessages({ session: fakeSession({ rollingSummary: summary }), prompt: {} });
  assert.match(user, /WHAT HAS HAPPENED SO FAR/);
  assert.match(user, /lynched and revealed heretic/);
});

test('prompt-assembly: user message stays near the ~3000 token soft target for a realistically full context', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push({ kind: 'chat_message', from: `p-${i % 5}`, author: `P${i % 5}`, text: 'A fairly typical chat line with some in-character reasoning about who might be lying. '.repeat(2) });
  const notesObj = {};
  for (let i = 0; i < 20; i++) notesObj[`note-${i}`] = 'Some observation about a player from an earlier round that is worth remembering.';
  const summary = new RollingSummary();
  for (let i = 0; i < 20; i++) summary.addAnnouncement({ type: 'lynch', title: 'SENTENCE EXECUTED', message: `Player ${i} was lynched and revealed loyalist.` }, i);
  const session = fakeSession({
    shortTermMemory: { items },
    notes: { size: 20, all: () => notesObj },
    rollingSummary: summary
  });
  const { user } = assembleMessages({ session, prompt: { kind: 'day_vote_prompt', legalTargets: ['p-1', 'p-2'] } });
  assert.ok(estimateTokens(user) <= 3200, `user message (${estimateTokens(user)} est. tokens) should stay near the ~3000 tok target`);
});

test('prompt-assembly: all 12 role blocks exist and are compact', () => {
  const ids = ['imperial-citizen', 'interrogator', 'chirurgeon', 'novice-psychic', 'arbitrator', 'priest', 'sanctioned-psyker', 'murderer', 'heretic-priest', 'conspirator', 'saboteur', 'recruiter'];
  for (const id of ids) {
    const b = roleBlock(id);
    assert.ok(b && b.length > 100, `${id} role block has substantive content`);
    assert.ok(b.includes('YOUR ROLE:'), `${id} role block header present`);
    assert.ok(estimateTokens(b) <= 320, `${id} role block (${estimateTokens(b)} est tok) should be compact`);
  }
});

test('prompt-assembly: STATIC_RULES is substantially compressed from the original ~1,325 tok', () => {
  assert.ok(estimateTokens(STATIC_RULES) <= 600, `STATIC_RULES is ${estimateTokens(STATIC_RULES)} est tok, target ~400-550`);
});
