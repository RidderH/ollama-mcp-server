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

import { buildHaystack, buildMultiHaystack, MULTI_NEEDLES, NEEDLE_CITY, NEEDLE_CODE } from './haystack.mjs';

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

/**
 * Guards on the multi-fact builder.
 *
 * The single-needle corpus answers "can it find one thing"; this one has to
 * answer "can it find five and combine them", which puts two extra demands on
 * the haystack. Every branch must carry a figure, or the model can match on
 * the presence of a number instead of on the city. And no distractor may carry
 * a needle's figure, or a right answer could be arrived at by reading the
 * wrong branch.
 */
describe('buildMultiHaystack', () => {
  const CITIES = MULTI_NEEDLES.map((needle) => needle.plaats);

  test('is deterministic for the same size and repeat', () => {
    assert.equal(buildMultiHaystack(30, 1).corpus, buildMultiHaystack(30, 1).corpus);
  });

  test('does not depend on what was built before it', () => {
    const first = buildMultiHaystack(30, 1).corpus;
    buildMultiHaystack(120, 3);
    buildHaystack(40, 0.1);
    assert.equal(buildMultiHaystack(30, 1).corpus, first);
  });

  test('contains every needle city exactly once at every size', () => {
    for (const count of [20, 60, 150]) {
      const { corpus } = buildMultiHaystack(count, 1);
      for (const city of CITIES) {
        assert.equal(
          (corpus.match(new RegExp(`## Vestiging ${city}$`, 'gm')) ?? []).length,
          1,
          `${city} at size ${count}`
        );
      }
    }
  });

  // A needle figure that also sits on a distractor branch would let a wrong
  // read produce a right answer, which is the one thing a grader cannot see.
  test('gives no distractor a needle figure', () => {
    for (const count of [20, 60, 150]) {
      const { corpus } = buildMultiHaystack(count, 1);
      for (const needle of MULTI_NEEDLES) {
        const dutch = needle.zendingen.toLocaleString('nl-NL');
        assert.equal(
          (corpus.match(new RegExp(`\\b${dutch.replace('.', '\\.')}\\b`, 'g')) ?? []).length,
          1,
          `${needle.plaats} (${dutch}) at size ${count}`
        );
      }
    }
  });

  test('gives every branch a figure and a code, so neither shape is the answer', () => {
    const count = 60;
    const { corpus } = buildMultiHaystack(count, 1);
    assert.equal((corpus.match(/zendingen verwerkt/g) ?? []).length, count);
    assert.equal(new Set(corpus.match(CODE)).size, count);
  });

  test('spreads the needles from the start of the corpus to the end', () => {
    const { placements } = buildMultiHaystack(150, 1);
    const fractions = placements.map((p) => p.fraction).sort((a, b) => a - b);
    assert.equal(new Set(fractions).size, 5, 'two needles landed in the same slot');
    assert.ok(fractions[0] < 0.15, `earliest needle at ${fractions[0]}`);
    assert.ok(fractions[4] > 0.85, `latest needle at ${fractions[4]}`);
  });

  // Finding 25: identical bytes make n=3 into n=1. The repeat has to move
  // something, and moving the needles samples position while it does it.
  test('a different repeat moves the needles without changing the facts', () => {
    const first = buildMultiHaystack(60, 1);
    const second = buildMultiHaystack(60, 2);
    assert.notEqual(first.corpus, second.corpus);
    assert.deepEqual(
      first.placements.map((p) => p.plaats).sort(),
      second.placements.map((p) => p.plaats).sort()
    );
    assert.notDeepEqual(
      first.placements.map((p) => `${p.plaats}@${p.index}`),
      second.placements.map((p) => `${p.plaats}@${p.index}`)
    );
  });

  test('grows roughly linearly with the branch count', () => {
    const small = buildMultiHaystack(20, 1).corpus.length;
    const large = buildMultiHaystack(80, 1).corpus.length;
    assert.ok(large > small * 3.5 && large < small * 4.5, `20 -> ${small}, 80 -> ${large}`);
  });
});
