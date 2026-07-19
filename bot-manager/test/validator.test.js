import test from 'node:test';
import assert from 'node:assert/strict';
import { actionValidator } from '../src/validator.js';

const ctx5p = (overrides = {}) => ({
  selfCode: 'HR-BOT-deadbeef',
  phase: 'night',
  round: 2,
  votingEnabled: true,
  crippleTier: 0,
  alivePlayers: ['HR-BOT-deadbeef', 'human-p1', 'human-p2', 'human-p3', 'human-p4'],
  usage: {},
  ...overrides
});

test('validator: pass is always accepted', () => {
  assert.equal(actionValidator('interrogator', { kind: 'pass' }, ctx5p()).ok, true);
});

test('validator: malformed action rejects', () => {
  const r = actionValidator('interrogator', { kind: 'explode' }, ctx5p());
  assert.equal(r.ok, false);
});

test('validator: L4 novice-psychic cannot target self', () => {
  const r = actionValidator('novice-psychic', { kind: 'night_action', verb: 'scan_drift', target: 'HR-BOT-deadbeef' }, ctx5p());
  assert.equal(r.ok, false);
  assert.match(r.reason, /self-target/i);
});

test('validator: L4 novice-psychic targeting another alive player is allowed', () => {
  const r = actionValidator('novice-psychic', { kind: 'night_action', verb: 'scan_drift', target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, true);
});

test('validator: L7 sanctioned-psyker cannot fire twice (uses=1)', () => {
  const r = actionValidator('sanctioned-psyker', { kind: 'night_action', verb: 'kill', target: 'human-p1' }, ctx5p({ usage: { kill: 1 } }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /once per game/i);
});

test('validator: L7 first-shot kill is allowed', () => {
  const r = actionValidator('sanctioned-psyker', { kind: 'night_action', verb: 'kill', target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, true);
});

test('validator: L2 interrogator rejects unknown tier', () => {
  const r = actionValidator('interrogator', { kind: 'night_action', verb: 'interrogate', tier: 9, target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, false);
});

test('validator: L2 interrogator rejects self-target', () => {
  const r = actionValidator('interrogator', { kind: 'night_action', verb: 'interrogate', tier: 2, target: 'HR-BOT-deadbeef' }, ctx5p());
  assert.equal(r.ok, false);
  assert.match(r.reason, /self-target/);
});

test('validator: L3 chirurgeon can self-protect', () => {
  const r = actionValidator('chirurgeon', { kind: 'night_action', verb: 'protect', target: 'HR-BOT-deadbeef' }, ctx5p());
  assert.equal(r.ok, true);
});

test('validator: L5 arbitrator cannot self-proxy', () => {
  const r = actionValidator('arbitrator', { kind: 'night_action', verb: 'bodyguard', target: 'HR-BOT-deadbeef' }, ctx5p());
  assert.equal(r.ok, false);
});

test('validator: L6 priest sermon sermonTier validation (whisper OK, invalid rejects)', () => {
  const r1 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'whisper', target: 'human-p1' }, ctx5p());
  assert.equal(r1.ok, true);
  const r2 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'bomb', target: 'human-p1' }, ctx5p());
  assert.equal(r2.ok, false);
});

test('validator: L6 priest hymn limit (2 per game)', () => {
  const r0 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'hymn', target: 'human-p1' }, ctx5p({ usage: { hymn: 0 } }));
  assert.equal(r0.ok, true);
  const r2 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'hymn', target: 'human-p1' }, ctx5p({ usage: { hymn: 2 } }));
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /limit reached/);
});

test('validator: L6 priest litany once per game', () => {
  const r0 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'litany', target: 'human-p1' }, ctx5p({ usage: { litany: 0 } }));
  assert.equal(r0.ok, true);
  const r1 = actionValidator('priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'litany', target: 'human-p1' }, ctx5p({ usage: { litany: 1 } }));
  assert.equal(r1.ok, false);
});

test('validator: H2 heretic-priest warp-litany requires target zone >= Orange', () => {
  const greenCtx = ctx5p({ targetZones: { 'human-p1': 'green' } });
  const r = actionValidator('heretic-priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'warp-litany', target: 'human-p1' }, greenCtx);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Orange/i);
});

test('validator: H2 heretic-priest warp-litany against Orange target is allowed', () => {
  const orangeCtx = ctx5p({ targetZones: { 'human-p1': 'orange' } });
  const r = actionValidator('heretic-priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'warp-litany', target: 'human-p1' }, orangeCtx);
  assert.equal(r.ok, true);
});

test('validator: H2 warp-litany passes when target zone unknown (drift-blind — defer to engine)', () => {
  // No targetZones in gameState → manager has no signal; the engine will reject
  // below Orange. The validator degrades by passing.
  const r = actionValidator('heretic-priest', { kind: 'night_action', verb: 'sermon', sermonTier: 'warp-litany', target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, true);
});

test('validator: H1 murderer cannot target a fellow Heretic when targetsByFaction provided', () => {
  const hereticTargets = ctx5p({ targetsByFaction: { heretic: ['human-p2'] } });
  const r = actionValidator('murderer', { kind: 'night_action', verb: 'kill', target: 'human-p2' }, hereticTargets);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Heretic/i);
});

test('validator: H4 saboteur cannot trap self', () => {
  const r = actionValidator('saboteur', { kind: 'night_action', verb: 'trap', target: 'HR-BOT-deadbeef' }, ctx5p());
  assert.equal(r.ok, false);
});

test('validator: H5 recruiter rejects if target not at Black (drift-blind — only when zone known)', () => {
  const greenCtx = ctx5p({ targetZones: { 'human-p1': 'green' } });
  const r = actionValidator('recruiter', { kind: 'night_action', verb: 'recruit', target: 'human-p1' }, greenCtx);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Black/);
});

test('validator: H5 recruiter passes when target zone unknown (engine is source of truth)', () => {
  const r = actionValidator('recruiter', { kind: 'night_action', verb: 'recruit', target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, true);
});

test('validator: Day 1 vote rejects (Q28)', () => {
  const r = actionValidator('imperial-citizen', { kind: 'vote', target: 'human-p1' }, ctx5p({ phase: 'day', round: 1, votingEnabled: false }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Day 1/);
});

test('validator: Day 2 vote for self rejects', () => {
  const r = actionValidator('imperial-citizen', { kind: 'vote', target: 'HR-BOT-deadbeef' }, ctx5p({ phase: 'day', round: 2, votingEnabled: true }));
  assert.equal(r.ok, false);
});

test('validator: Day 2 vote for skip is always OK', () => {
  const r = actionValidator('imperial-citizen', { kind: 'vote', target: 'skip' }, ctx5p({ phase: 'day', round: 2, votingEnabled: true }));
  assert.equal(r.ok, true);
});

test('validator: chat fails at night (engine side will also reject)', () => {
  const r = actionValidator('imperial-citizen', { kind: 'chat', text: 'hi' }, ctx5p({ phase: 'night' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /public chat is closed at night/);
});

test('validator: chat fails when text is empty', () => {
  const r = actionValidator('imperial-citizen', { kind: 'chat', text: '' }, ctx5p({ phase: 'day', round: 2 }));
  assert.equal(r.ok, false);
});

test('validator: cripple T2 rejects every night action', () => {
  const r = actionValidator('interrogator', { kind: 'night_action', verb: 'interrogate', tier: 1, target: 'human-p1' }, ctx5p({ crippleTier: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /crippled/);
});

test('validator: role imperatives (verb outside of role verbs)', () => {
  // Imperial citizen cannot interrogate
  const r = actionValidator('imperial-citizen', { kind: 'night_action', verb: 'interrogate', tier: 1, target: 'human-p1' }, ctx5p());
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot perform/);
});

test('validator: night-action during day phase rejects', () => {
  const r = actionValidator('interrogator', { kind: 'night_action', verb: 'interrogate', tier: 2, target: 'human-p1' }, ctx5p({ phase: 'day' }));
  assert.equal(r.ok, false);
});