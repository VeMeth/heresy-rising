import test from 'node:test';
import assert from 'node:assert/strict';
import { isNearDuplicate } from '../src/textDedup.js';

test('textDedup: exact repeat is a duplicate', () => {
  const text = 'I am an Interrogator, and I will use my abilities to help uncover the heretics among us.';
  assert.equal(isNearDuplicate(text, [text]), true);
});

test('textDedup: near-identical wording (case/punctuation only) is a duplicate', () => {
  const original = 'I believe that Drago is not the Imperial Citizen, as Town claimed.';
  const restated = 'i believe that drago is not the imperial citizen as town claimed';
  assert.equal(isNearDuplicate(restated, [original]), true);
});

test('textDedup: substantively different content is not a duplicate', () => {
  const original = 'I believe that Drago is not the Imperial Citizen, as Town claimed.';
  const fresh = 'Coteaz has been quiet all round — I want to hear their reasoning before we vote.';
  assert.equal(isNearDuplicate(fresh, [original]), false);
});

test('textDedup: no duplicate when others list is empty', () => {
  assert.equal(isNearDuplicate('anything at all here', []), false);
});

test('textDedup: very short candidate text is never flagged (too little signal)', () => {
  assert.equal(isNearDuplicate('skip', ['skip']), false);
});

test('textDedup: checks against every entry in the others list, not just the first', () => {
  const target = 'Vote justification: Drago has been accused multiple times and was interrogated, which suggests he may be hiding something.';
  const others = ['unrelated message one', 'another unrelated line', target];
  assert.equal(isNearDuplicate(target, others), true);
});
