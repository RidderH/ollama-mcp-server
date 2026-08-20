/**
 * Guards on the haystack builder.
 *
 * These probes measure whether the model can find one fact in a large prompt.
 * That only means anything if the fact is in there exactly once, if the rest
 * of the prompt is full of plausible near-misses, and if the corpus is the
 * same bytes on every run. Each of those is checked here rather than assumed.
 *
 * Run: node --test evals/lib/haystack.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { buildHaystack, NEEDLE_CITY, NEEDLE_CODE } from './haystack.mjs';

const CODE = /[A-Z][A-Z]-\d{4}-[A-Z]/g;

describe('buildHaystack', () => {
  test('is deterministic across calls', () => {
    assert.equal(buildHaystack(20, 0.5), buildHaystack(20, 0.5));
  });

  test('does not depend on what was built before it', () => {
    const first = buildHaystack(20, 0.5);
    buildHaystack(90, 0.1);
    assert.equal(buildHaystack(20, 0.5), first);
  });

  test('contains the needle code exactly once at every size', () => {
    for (const count of [10, 40, 130]) {
      const text = buildHaystack(count, 0.5);
      assert.equal((text.match(new RegExp(NEEDLE_CODE, 'g')) ?? []).length, 1, `size ${count}`);
      assert.equal((text.match(new RegExp(`Vestiging ${NEEDLE_CITY}`, 'g')) ?? []).length, 1, `size ${count}`);
    }
  });

  // A haystack whose only code is the answer tests nothing: the model could
  // match on shape alone and never read a city name.
  test('surrounds the needle with one distractor code per branch', () => {
    const codes = new Set(buildHaystack(40, 0.5).match(CODE));
    assert.equal(codes.size, 40);
    assert.ok(codes.has(NEEDLE_CODE));
  });

  test('places the needle where it was asked to', () => {
    const early = buildHaystack(40, 0).indexOf(NEEDLE_CODE);
    const middle = buildHaystack(40, 0.5).indexOf(NEEDLE_CODE);
    const late = buildHaystack(40, 1).indexOf(NEEDLE_CODE);
    assert.ok(early < middle, 'position 0 must land before position 0.5');
    assert.ok(middle < late, 'position 0.5 must land before position 1');
    const total = buildHaystack(40, 1).length;
    assert.ok(early / total < 0.1, `position 0 landed at ${(early / total).toFixed(2)} of the way in`);
    assert.ok(late / total > 0.9, `position 1 landed at ${(late / total).toFixed(2)} of the way in`);
  });

  test('grows roughly linearly with the branch count', () => {
    const small = buildHaystack(20, 0.5).length;
    const large = buildHaystack(80, 0.5).length;
    assert.ok(large > small * 3.5 && large < small * 4.5, `20 -> ${small}, 80 -> ${large}`);
  });
});
