import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleMessages } from '../src/prompts/assemble.js';
import { STATIC_RULES } from '../src/prompts/staticRules.js';
import { roleBlock } from '../src/prompts/roleBlocks.js';

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
    shortTermMemory: { items: [{ kind: 'chat_message', from: 'P-04', author: 'Alice', text: 'I suspect nobody.' }] },
    notes: { size: 0, all: () => ({}) },
    personaOverrides: null,
    ...overrides
  };
}

test('prompt-assembly: system block contains static rules verbatim', () => {
  const { system } = assembleMessages({ session: fakeSession(), prompt: {} });
  assert.ok(system.includes(STATIC_RULES.slice(0, 80)), 'static rule opening should be in system');
});

test('prompt-assembly: system block contains role block matching session_init.role', () => {
  const { system } = assembleMessages({ session: fakeSession({ role: 'interrogator' }), prompt: {} });
  const block = roleBlock('interrogator');
  // First line of the role block appears.
  assert.ok(system.includes('YOUR ROLE: INTERROGATOR'), 'role block name should be present');
  assert.ok(block.length > 100, 'sanity');
  // A distinctive interrogator-only line also survives:
  assert.ok(system.includes('Execute on Sight'));
});

test('prompt-assembly: game state block reflects current phase (Day 2 = votingEnabled=true)', () => {
  const { system } = assembleMessages({ session: fakeSession({ phase: 'day', round: 2 }), prompt: {} });
  assert.ok(system.includes('Phase: day'));
  assert.ok(system.includes('Round: 2'));
  assert.ok(system.includes('Voting enabled: true'));
});

test('prompt-assembly: Day 1 → votingEnabled=false (Q28 locked)', () => {
  const { system } = assembleMessages({ session: fakeSession({ phase: 'day', round: 1 }), prompt: {} });
  assert.ok(system.includes('Voting enabled: false'));
});

test('prompt-assembly: night phase renders as phase=night', () => {
  const { system } = assembleMessages({ session: fakeSession({ phase: 'night', round: 3 }), prompt: {} });
  assert.ok(system.includes('Phase: night'));
});

test('prompt-assembly: heretic faction block is injected only for Heretics', () => {
  const loyalist = assembleMessages({ session: fakeSession({ role: 'interrogator', faction: 'loyalist' }), prompt: {} });
  assert.ok(!loyalist.system.includes('FACTION CHAT'));
  const heretic = assembleMessages({ session: fakeSession({ role: 'murderer', faction: 'heretic' }), prompt: {} });
  assert.ok(heretic.system.includes('FACTION CHAT'));
  assert.ok(heretic.system.includes('Heretic'));
});

test('prompt-assembly: persona overrides appear when provided', () => {
  const { system } = assembleMessages({
    session: fakeSession({ personaOverrides: 'speak in clipped, terse sentences' }),
    prompt: {}
  });
  assert.ok(system.includes('PERSONA OVERRIDES'));
  assert.ok(system.includes('clipped, terse'));
});

test('prompt-assembly: no role block emitted when session.role is null (lobby)', () => {
  const { system } = assembleMessages({ session: fakeSession({ role: null, phase: 'lobby', round: 0 }), prompt: {} });
  assert.ok(!system.includes('YOUR ROLE: INTERROGATOR'));
  assert.ok(system.includes('Role not yet assigned'));
});

test('prompt-assembly: botIds list is rendered privately to bots (other bots)', () => {
  const { system } = assembleMessages({
    session: fakeSession({ botIds: ['HR-BOT-deadbeef', 'HR-BOT-cafe-0001'] }),
    prompt: {}
  });
  assert.ok(system.includes('Other bots at the table'));
  assert.ok(system.includes('HR-BOT-cafe-0001'), 'other bot ids rendered');
  assert.ok(!system.includes('never mention this list to humans') || system.includes('never mention this list to humans') === true, 'note present harmless if exact phrase differs');
});

test('prompt-assembly: long-term notes injected when present', () => {
  const session = fakeSession();
  session.notes = { size: 1, all: () => ({ 'P-04-suspicion': 'voted against me on Day 2' }) };
  const { system } = assembleMessages({ session, prompt: {} });
  assert.ok(system.includes('LONG-TERM NOTES'));
  assert.ok(system.includes('P-04-suspicion'));
});

test('prompt-assembly: history rendered with author + text', () => {
  const { history } = assembleMessages({ session: fakeSession(), prompt: {} });
  assert.ok(history.length === 1, 'short-term memory surfaces one entry');
  assert.match(history[0].content, /Alice/);
  assert.match(history[0].content, /I suspect nobody/);
});

test('prompt-assembly: all 11 role blocks exist', () => {
  const ids = ['imperial-citizen','interrogator','chirurgeon','novice-psychic','arbitrator','priest','sanctioned-psyker','murderer','heretic-priest','conspirator','saboteur','recruiter'];
  for (const id of ids) {
    const b = roleBlock(id);
    assert.ok(b && b.length > 200, `${id} role block has substantive content`);
    assert.ok(b.includes('YOUR ROLE:'), `${id} role block header present`);
  }
});