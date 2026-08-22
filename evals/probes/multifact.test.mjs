/**
 * Guards on the multi-fact probe's prompt.
 *
 * Two ways this probe could measure nothing, both invisible in a pass rate.
 * The answer could be *in* the prompt -- if any branch carried the total, or
 * if the question restated a figure, the model would not have to retrieve
 * anything. And the repeats could send identical bytes, which finding 25
 * showed turns n=3 into n=1.
 *
 * Run: node --test evals/probes/multifact.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { MULTI_NEEDLES } from '../lib/haystack.mjs';
import { MULTIFACT_PROBES } from './multifact.mjs';

const PROBE = MULTIFACT_PROBES[0];
const TOTAL = MULTI_NEEDLES.reduce((sum, needle) => sum + needle.zendingen, 0);

describe('the multi-fact prompt', () => {
  test('asks about every needle city by name', () => {
    const question = PROBE.build(1).prompt.split('Vraag:')[1];
    for (const needle of MULTI_NEEDLES) assert.ok(question.includes(needle.plaats), needle.plaats);
  });

  // The figures belong in the corpus and nowhere else: a question repeating
  // one would hand back the fact it is asking the model to find.
  test('never states a figure in the question', () => {
    const question = PROBE.build(1).prompt.split('Vraag:')[1];
    for (const needle of MULTI_NEEDLES) {
      assert.equal(question.includes(String(needle.zendingen)), false, `${needle.plaats} raw`);
      assert.equal(question.includes(needle.zendingen.toLocaleString('nl-NL')), false, `${needle.plaats} nl`);
    }
  });

  test('the total appears nowhere in the prompt, in either notation', () => {
    const prompt = PROBE.build(1).prompt;
    assert.equal(prompt.includes(String(TOTAL)), false);
    assert.equal(prompt.includes(TOTAL.toLocaleString('nl-NL')), false);
  });

  test('each repeat sends different bytes', () => {
    const prompts = [1, 2, 3].map((repeat) => PROBE.build(repeat).prompt);
    assert.equal(new Set(prompts).size, 3);
  });

  test('the ladder climbs in even steps, so a failure can be placed on it', () => {
    const lengths = MULTIFACT_PROBES.map((probe) => probe.build(1).prompt.length);
    const steps = lengths.slice(1).map((length, i) => length - lengths[i]);
    for (const step of steps) {
      assert.ok(step > 0, `lengths went ${lengths.join(' -> ')}`);
      assert.ok(Math.abs(step - steps[0]) / steps[0] < 0.05, `uneven rungs: ${steps.join(', ')}`);
    }
  });
});
