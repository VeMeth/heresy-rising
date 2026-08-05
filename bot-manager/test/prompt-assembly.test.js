import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleMessages, buildSystemPrompt } from '../src/prompts/assemble.js';
import { STATIC_RULES, STATIC_RULES_FULL, staticRulesFor } from '../src/prompts/staticRules.js';
import { ROLE_BLOCKS, roleBlock, roleBlockFor } from '../src/prompts/roleBlocks.js';
import { BUDGETS, MIN_CHAT_LINES, budgetsFor, minChatLinesFor, estimateTokens } from '../src/prompts/budget.js';
import { RollingSummary, StructuredNotes } from '../src/memory.js';

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

test('prompt-assembly: phase summaries render as a separate section between rolling summary and notes; empty array omits the section entirely', () => {
  const session = fakeSession({
    phaseSummaries: [
      { phase: 'night', round: 1, summary: 'A-1 was killed by unknown. No clear suspects.' },
      { phase: 'day', round: 1, summary: 'B-2 accused C-3 without evidence. D-4 defended.' }
    ],
    // Notes are required to render the YOUR NOTES section in the asserted
    // section ordering — otherwise the comparison index is -1 and the
    // ordering check is meaningless.
    notes: { size: 1, all: () => ({ 'note-key': 'curated note' }) }
  });
  const { user } = assembleMessages({ session, prompt: {} });
  assert.match(user, /PHASE SUMMARIES/);
  assert.match(user, /Round 1 night/);
  assert.match(user, /A-1 was killed by unknown/);
  assert.match(user, /Round 1 day/);
  assert.match(user, /B-2 accused C-3/);
  // Section order: rolling summary (none here) → phase summaries → notes → chat → turn.
  const idxPhaseSummaries = user.indexOf('PHASE SUMMARIES');
  const idxNotes = user.indexOf('YOUR NOTES');
  assert.ok(idxPhaseSummaries < idxNotes, 'phase summaries must render before notes');
  const idxChat = user.indexOf('RECENT CHAT');
  assert.ok(idxPhaseSummaries < idxChat, 'phase summaries must render before recent chat');
});

test('prompt-assembly: empty phaseSummaries array omits the section entirely (local-profile behaviour)', () => {
  const { user } = assembleMessages({ session: fakeSession({ phaseSummaries: [] }), prompt: {} });
  assert.doesNotMatch(user, /PHASE SUMMARIES/);
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

// --- Wave 2 (Q-BOT-PROFILES) — profile-scaled budgets --------------------

function manyChatItems(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ kind: 'chat_message', from: `p-${i}`, author: `P${i}`, text: `message number ${i} `.repeat(20) });
  }
  return items;
}

test('prompt-assembly: budgetsFor(undefined)/no-profile is byte-identical to the scale-1 BUDGETS constant (local-invariance guardrail)', () => {
  const scaled = budgetsFor(undefined);
  assert.deepEqual(scaled, BUDGETS);
  assert.deepEqual(scaled, { stateDigest: 150, rollingSummary: 200, phaseSummaries: 800, notes: 150, recentChat: 800, turnInstruction: 120 });
  assert.equal(minChatLinesFor(undefined), MIN_CHAT_LINES);
  assert.equal(minChatLinesFor(undefined), 6);
});

test('prompt-assembly: a session with no _profile assembles identically to before profile-scaling existed', () => {
  const items = manyChatItems(40);
  const session = fakeSession({ shortTermMemory: { items } });
  const { user } = assembleMessages({ session, prompt: {} });
  let keptCount = 0;
  for (let i = 0; i < 40; i++) if (user.includes(`message number ${i} `)) keptCount++;
  // Same shape as the pre-existing eviction test: oldest dropped, newest kept, >= MIN_CHAT_LINES survive.
  assert.ok(!user.includes('message number 0 '), 'oldest evicted first');
  assert.ok(user.includes('message number 39'), 'newest always survives');
  assert.ok(keptCount >= 6 && keptCount < 40, `local/no-profile keeps a small tail (kept ${keptCount})`);
});

test('prompt-assembly: a scale-6 profile keeps roughly 6x the recent-chat lines of the scale-1 default', () => {
  const items = manyChatItems(60);
  const localSession = fakeSession({ shortTermMemory: { items } });
  const cloudSession = fakeSession({
    shortTermMemory: { items },
    _profile: { id: 'minimax-m2.7', budgetScale: 6, minChatLines: 20, noThinkSuffix: false }
  });
  const localKept = countKeptChatLines(assembleMessages({ session: localSession, prompt: {} }).user, 60);
  const cloudKept = countKeptChatLines(assembleMessages({ session: cloudSession, prompt: {} }).user, 60);
  assert.ok(cloudKept > localKept, `scaled profile (${cloudKept}) should keep more lines than local (${localKept})`);
  // "Roughly 6x": generous band since eviction is line-granular, not byte-exact.
  const ratio = cloudKept / localKept;
  assert.ok(ratio >= 3 && ratio <= 9, `expected ~6x chat lines kept, got ratio ${ratio.toFixed(2)} (local ${localKept}, cloud ${cloudKept})`);
  assert.ok(cloudKept >= 20, 'scaled profile honours its own minChatLines floor');
});

function countKeptChatLines(user, n) {
  let count = 0;
  for (let i = 0; i < n; i++) if (user.includes(`message number ${i} `)) count++;
  return count;
}

test('prompt-assembly: noThinkSuffix:false omits /no_think from the system prompt; default (no profile) still appends it', () => {
  const withoutProfile = assembleMessages({ session: fakeSession(), prompt: {} }).system;
  assert.ok(withoutProfile.endsWith('/no_think'), 'no-profile session keeps today\'s default (local) behaviour');

  const localProfile = assembleMessages({ session: fakeSession({ _profile: { id: 'local', noThinkSuffix: true } }), prompt: {} }).system;
  assert.ok(localProfile.endsWith('/no_think'));

  const cloudProfile = assembleMessages({ session: fakeSession({ _profile: { id: 'minimax-m2.7', noThinkSuffix: false } }), prompt: {} }).system;
  assert.ok(!cloudProfile.includes('/no_think'), 'MiniMax profile must not get the Qwen3 /no_think convention');
});

test('prompt-assembly: system-prompt cache key changes across profiles (never serves a local-shaped prompt to a cloud bot)', () => {
  const session = fakeSession({ _profile: { id: 'local', noThinkSuffix: true } });
  assembleMessages({ session, prompt: {} });
  const keyLocal = session._systemPromptCacheKey;
  const cacheLocal = session._systemPromptCache;

  session._profile = { id: 'minimax-m2.7', noThinkSuffix: true }; // same noThinkSuffix, different id
  assembleMessages({ session, prompt: {} });
  const keyCloud = session._systemPromptCacheKey;

  assert.notEqual(keyLocal, keyCloud, 'cache key must depend on profile.id, not just its derived noThinkSuffix effect');
  assert.equal(cacheLocal, session._systemPromptCache, 'content happens to be identical here since noThinkSuffix matched, proving the key alone drove the rebuild');
});

test('prompt-assembly: StructuredNotes honours a per-instance key cap while keeping the static default', () => {
  assert.equal(StructuredNotes.MAX_KEYS, 15, 'static default is unchanged');

  const defaultNotes = new StructuredNotes();
  assert.equal(defaultNotes.maxKeys, 15);

  const scaledNotes = new StructuredNotes({ maxKeys: 3 });
  scaledNotes.set('a', '1');
  scaledNotes.set('b', '2');
  scaledNotes.set('c', '3');
  scaledNotes.set('d', '4'); // evicts 'a'
  assert.equal(scaledNotes.size, 3);
  assert.equal(scaledNotes.get('a'), undefined, 'oldest key evicted once over the per-instance cap');
  assert.equal(scaledNotes.get('d'), '4');

  const bigNotes = new StructuredNotes({ maxKeys: 40 });
  for (let i = 0; i < 20; i++) bigNotes.set(`k${i}`, String(i));
  assert.equal(bigNotes.size, 20, 'a larger per-instance cap (m2.7 scale) does not evict early');
});

// --- Wave 3 (Q-BOT-PROFILES §5, agent F) — rich prompts for richPrompt profiles

test('rich-prompts: a no-profile/local session system prompt is byte-identical to the compressed output (local-invariance guardrail)', () => {
  // No talkativeness/personaOverrides so buildSystemPrompt's own persona
  // block is empty — the reconstruction below then exactly mirrors what
  // buildSystemPrompt does with STATIC_RULES + roleBlock() directly, proving
  // the profile-aware selectors resolve to the same compressed exports for
  // a no-profile session.
  const minimalSession = fakeSession({ role: 'interrogator', personaOverrides: null, talkativeness: null, _profile: undefined });
  const before = [STATIC_RULES, roleBlock('interrogator')].filter(Boolean).join('\n\n---\n\n') + '\n\n/no_think';
  const noProfile = buildSystemPrompt(minimalSession);
  assert.equal(noProfile, before);

  const localProfile = buildSystemPrompt({ ...minimalSession, _profile: { id: 'local', richPrompt: false, noThinkSuffix: true } });
  assert.equal(localProfile, before, 'an explicit local profile (richPrompt: false) is byte-identical to no profile at all');

  // And unaffected by talkativeness/personaOverrides being present, as long
  // as the same session is compared against itself with/without a profile —
  // the selectors, not the persona machinery, are what's under test.
  const chattySession = fakeSession({ role: 'interrogator', _profile: undefined });
  const chattyWithLocalProfile = { ...chattySession, _profile: { id: 'local', richPrompt: false, noThinkSuffix: true } };
  assert.equal(buildSystemPrompt(chattySession), buildSystemPrompt(chattyWithLocalProfile));
});

test('rich-prompts: staticRulesFor(undefined) and staticRulesFor({richPrompt:false}) return the byte-identical compressed STATIC_RULES', () => {
  assert.equal(staticRulesFor(undefined), STATIC_RULES);
  assert.equal(staticRulesFor({ richPrompt: false }), STATIC_RULES);
});

test('rich-prompts: a richPrompt profile produces a longer system prompt containing the full static rules and full role text', () => {
  const richProfile = { id: 'minimax-m2.7', richPrompt: true, noThinkSuffix: false };
  const compressed = buildSystemPrompt(fakeSession({ role: 'interrogator', _profile: { id: 'local', richPrompt: false, noThinkSuffix: true } }));
  const rich = buildSystemPrompt(fakeSession({ role: 'interrogator', _profile: richProfile }));

  assert.ok(rich.length > compressed.length, 'rich prompt should be longer than the compressed one');
  assert.equal(staticRulesFor(richProfile), STATIC_RULES_FULL);
  assert.ok(rich.includes(STATIC_RULES_FULL));
  assert.ok(rich.includes('YOUR ROLE: INTERROGATOR'));
  assert.ok(rich.includes('Execute on Sight'), 'restored Interrogator text keeps the Execute on Sight mechanic');
});

test('rich-prompts: STATIC_RULES_FULL still ends with the same binding JSON action instruction as the compressed STATIC_RULES', () => {
  const jsonInstruction = 'Reply with ONLY a JSON action';
  assert.ok(STATIC_RULES.includes(jsonInstruction));
  assert.ok(STATIC_RULES_FULL.includes(jsonInstruction));
  // Same closing sentence in both — the parser depends on this exact shape regardless of profile.
  const tail = STATIC_RULES.slice(STATIC_RULES.indexOf(jsonInstruction));
  assert.ok(STATIC_RULES_FULL.endsWith(tail), 'full rules end with byte-identical binding action-format text');
});

test('rich-prompts: every role id in ROLE_BLOCKS resolves under both roleBlock and roleBlockFor (compressed + rich) without throwing', () => {
  for (const roleId of ROLE_BLOCKS.keys()) {
    const compressed = roleBlock(roleId);
    assert.ok(compressed && compressed.includes('YOUR ROLE:'), `${roleId} compressed block resolves`);

    const localVariant = roleBlockFor(roleId, { richPrompt: false });
    assert.equal(localVariant, compressed, `${roleId} falls back to the compressed block when richPrompt is false`);

    const richVariant = roleBlockFor(roleId, { richPrompt: true });
    assert.ok(richVariant && richVariant.includes('YOUR ROLE:'), `${roleId} resolves to a role block under a rich profile`);
  }
});

test('rich-prompts: roleBlockFor with no profile behaves exactly like roleBlock (compressed default)', () => {
  for (const roleId of ROLE_BLOCKS.keys()) {
    assert.equal(roleBlockFor(roleId, undefined), roleBlock(roleId));
  }
  assert.equal(roleBlockFor(null, undefined), roleBlock(null));
  assert.equal(roleBlockFor(null, { richPrompt: true }), roleBlock(null), 'no role assigned falls back regardless of profile');
});
