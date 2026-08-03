// Ability copy is rendered from abilityTemplate + a role's own numeric cost
// fields (driftWeight, sermonTiers) plus shared drift config, rather than
// hand-typed with the numbers baked into prose — so that when drift costs
// stop being fixed, only what feeds buildCostContext() changes, never the
// templates or this renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSigned, renderTemplate, buildCostContext, renderAbility } from '../src/mechanics/abilityText.js';
import { loadGameConfig } from '../src/gameConfig.js';

test('formatSigned renders the game\'s own minus glyph, not an ASCII hyphen', () => {
  assert.equal(formatSigned(15), '+15');
  assert.equal(formatSigned(-2), '−2'); // U+2212, matches every hand-written cost already in the game's copy
  assert.equal(formatSigned(0), '0');
});

test('renderTemplate substitutes every placeholder and leaves plain text untouched', () => {
  assert.equal(renderTemplate('flat text, no placeholders', {}), 'flat text, no placeholders');
  assert.equal(renderTemplate('costs {a} then {b} then {a} again', { a: '+3', b: '−1' }), 'costs +3 then −1 then +3 again');
});

test('renderTemplate fails loud on a placeholder with no matching value — a bug in the data, not something to silently blank out', () => {
  assert.throws(() => renderTemplate('costs {unknownKey}', {}), /unknown placeholder \{unknownKey\}/);
});

test('buildCostContext derives every value from the role\'s own fields and the shared drift config — never a re-typed constant', () => {
  const drift = { MAX_DRIFT: 20, NIGHTLY_SLEEP_RECOVERY: -1, TRAP_DRIFT: 5, zones: [{ id: 'red', min: 15, max: 19 }, { id: 'black', min: 20, max: 20 }] };
  const ctx = buildCostContext({ driftWeight: 3 }, drift);
  assert.equal(ctx.driftWeight, '+3');
  assert.equal(ctx.maxDrift, 20);
  assert.equal(ctx.sleepRecovery, '−1');
  assert.equal(ctx.trapDrift, '+5');
  assert.equal(ctx.redMin, 15);
  assert.equal(ctx.redMax, 19);
  assert.equal(ctx.blackMin, 20);
  // Recruiter's "combo total" (base catalyst cost + a sprung trap) is
  // derived arithmetic from the other two numbers, not stored separately —
  // it cannot go stale relative to itself.
  assert.equal(ctx.recruiterComboTotal, formatSigned(3 + 5));
});

test('buildCostContext only exposes sermon placeholders for a role that actually has sermonTiers, and reads targetEffect (not selfCost)', () => {
  const drift = { MAX_DRIFT: 20, NIGHTLY_SLEEP_RECOVERY: -1, TRAP_DRIFT: 5, zones: [{ id: 'red', min: 15, max: 19 }, { id: 'black', min: 20, max: 20 }] };
  const withSermons = buildCostContext({ driftWeight: 0, sermonTiers: { whisper: { selfCost: 1, targetEffect: -2 }, hymn: { selfCost: 3, targetEffect: -5 }, litany: { selfCost: 6, targetEffect: -10 } } }, drift);
  assert.equal(withSermons.whisperTarget, '−2');
  assert.equal(withSermons.hymnTarget, '−5');
  assert.equal(withSermons.litanyTarget, '−10');

  const withoutSermons = buildCostContext({ driftWeight: 2 }, drift);
  assert.equal('whisperTarget' in withoutSermons, false);
});

test('renderAbility falls back to a role\'s plain `ability` string if it has no abilityTemplate at all', () => {
  const drift = { MAX_DRIFT: 20, NIGHTLY_SLEEP_RECOVERY: -1, TRAP_DRIFT: 5, zones: [{ id: 'red', min: 15, max: 19 }, { id: 'black', min: 20, max: 20 }] };
  assert.equal(renderAbility({ ability: 'plain string, no template' }, drift), 'plain string, no template');
});

test('loadGameConfig renders every shipped role\'s ability text with no leftover {placeholder} and no thrown error', () => {
  const cfg = loadGameConfig();
  assert.equal(cfg.roleList.length, 14, 'sanity: still the 14-role roster this test was written against (13 + H7 Poxwalker)');
  for (const role of cfg.roleList) {
    assert.equal(typeof role.ability, 'string');
    assert.ok(role.ability.length > 0, `${role.id} has empty ability text`);
    assert.doesNotMatch(role.ability, /\{[a-zA-Z]+\}/, `${role.id}'s rendered ability text has an unfilled placeholder: ${role.ability}`);
  }
});

test('Interrogator\'s boot-time (no game context) ability text shows a table-size RANGE per tier, not a fixed number — Q31 scaled costs', () => {
  const cfg = loadGameConfig();
  const interrogator = cfg.roles.get('interrogator');
  // 5p = priciest, 12p = cheapest (data/drift.json scaledCosts.interrogator).
  assert.match(interrogator.ability, /T1 Soft \([^)]*\+1–\+2 drift\)/);
  assert.match(interrogator.ability, /T2 Standard \([^)]*\+2–\+4 drift\)/);
  assert.match(interrogator.ability, /T3 Brutal \([^)]*\+4–\+10 drift\)/);
});

test('Interrogator\'s per-game ability text (roleForDisplay) shows this game\'s EXACT scaled cost, cheaper at a bigger table', () => {
  const cfg = loadGameConfig();
  const interrogator = cfg.roles.get('interrogator');
  const at5p = renderAbility(interrogator, cfg.drift, { playerCount: 5 });
  const at12p = renderAbility(interrogator, cfg.drift, { playerCount: 12 });
  assert.match(at5p, /T1 Soft \([^)]*\+2 drift\)/);
  assert.match(at5p, /T3 Brutal \([^)]*\+10 drift\)/);
  assert.match(at12p, /T1 Soft \([^)]*\+1 drift\)/);
  assert.match(at12p, /T3 Brutal \([^)]*\+4 drift\)/);
  assert.doesNotMatch(at5p, /\{[a-zA-Z]+\}/);
  assert.doesNotMatch(at12p, /\{[a-zA-Z]+\}/);
});
