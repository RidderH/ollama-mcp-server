/**
 * Tests for the classification graders.
 *
 * The thing being measured is whether a caller can tell a forced fit from a
 * right answer, so the graders have to separate three outcomes that all look
 * alike in a result: a label outside the vocabulary, a valid label on the
 * wrong row, and a valid label on a row that has no right answer at all.
 * Each gets a known-BAD fixture that must fail for its own reason.
 *
 * Run: node --test evals/lib/classify.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeClassification, gradeDoubtSignal } from './classify.mjs';

const ALLOWED = ['reiskosten', 'software', 'overig'];
const TRUTH = { R1: 'reiskosten', R2: 'software', R3: 'overig' };

const perfect = [
  { id: 'R1', categorie: 'reiskosten' },
  { id: 'R2', categorie: 'software' },
  { id: 'R3', categorie: 'overig' }
];

describe('gradeClassification', () => {
  test('accepts a complete, in-vocabulary, correct answer', () => {
    const result = gradeClassification(perfect, { allowed: ALLOWED, truth: TRUTH });
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.correct, 3);
    assert.equal(result.escapeUsed, 1);
  });

  test('KNOWN BAD: an invented category is caught even when it is a reasonable one', () => {
    const result = gradeClassification(
      [...perfect.slice(0, 2), { id: 'R3', categorie: 'oprichtingskosten' }],
      { allowed: ALLOWED, truth: TRUTH }
    );
    assert.equal(result.pass, false);
    assert.deepEqual(result.outOfVocabulary, [{ id: 'R3', categorie: 'oprichtingskosten' }]);
  });

  test('KNOWN BAD: a valid label on the wrong row fails, and is named', () => {
    const result = gradeClassification(
      [{ id: 'R1', categorie: 'reiskosten' }, { id: 'R2', categorie: 'software' }, { id: 'R3', categorie: 'software' }],
      { allowed: ALLOWED, truth: TRUTH }
    );
    assert.equal(result.pass, false);
    assert.equal(result.outOfVocabulary.length, 0, 'this failure is not a vocabulary failure');
    assert.deepEqual(result.wrong, [{ id: 'R3', expected: 'overig', actual: 'software' }]);
  });

  test('KNOWN BAD: a dropped row fails — a short list is still a valid list', () => {
    const result = gradeClassification(perfect.slice(0, 2), { allowed: ALLOWED, truth: TRUTH });
    assert.equal(result.pass, false);
    assert.deepEqual(result.missingIds, ['R3']);
  });

  test('KNOWN BAD: an invented row fails', () => {
    const result = gradeClassification([...perfect, { id: 'R4', categorie: 'software' }], {
      allowed: ALLOWED,
      truth: TRUTH
    });
    assert.equal(result.pass, false);
    assert.deepEqual(result.extraIds, ['R4']);
  });

  test('KNOWN BAD: the same row answered twice fails rather than counting twice', () => {
    const result = gradeClassification([...perfect, { id: 'R1', categorie: 'software' }], {
      allowed: ALLOWED,
      truth: TRUTH
    });
    assert.equal(result.pass, false);
    assert.ok(result.duplicateIds.includes('R1'));
  });

  test('KNOWN BAD: a label outside a closed vocabulary fails even when it matches truth', () => {
    // The closed variant: 'overig' is the right answer for R3 and is deliberately
    // NOT offered as a choice. A model that reaches for it anyway is breaking
    // vocabulary to say "none of these fit" — which the probe reads as the good
    // outcome, and this grader still has to report as out of vocabulary. Without
    // this case the vocabulary term in `pass` is never the deciding one, and
    // neutering it leaves the whole suite green.
    const closed = ['reiskosten', 'software'];
    const result = gradeClassification(perfect, { allowed: closed, truth: TRUTH });
    assert.equal(result.correct, 3, 'every row matches ground truth');
    assert.deepEqual(result.missingIds, []);
    assert.deepEqual(result.extraIds, []);
    assert.equal(result.pass, false, 'and it still fails, on the vocabulary term alone');
    assert.deepEqual(result.outOfVocabulary, [{ id: 'R3', categorie: 'overig' }]);
  });

  test('order does not matter — the rows are graded by id', () => {
    const result = gradeClassification([...perfect].reverse(), { allowed: ALLOWED, truth: TRUTH });
    assert.equal(result.pass, true, JSON.stringify(result));
  });

  test('counts how often the escape was reached for, which is a finding either way', () => {
    const allEscape = perfect.map((item) => ({ ...item, categorie: 'overig' }));
    const result = gradeClassification(allEscape, { allowed: ALLOWED, truth: TRUTH });
    assert.equal(result.escapeUsed, 3);
    assert.equal(result.pass, false, 'escaping everything is not a pass');
  });

  test('KNOWN BAD: not an array at all fails without throwing', () => {
    const result = gradeClassification(undefined, { allowed: ALLOWED, truth: TRUTH });
    assert.equal(result.pass, false);
    assert.equal(result.correct, 0);
  });
});

describe('gradeDoubtSignal — does a confidence field separate the forced fits?', () => {
  const HARD = ['R3'];

  test('passes when every hard row is flagged and no easy row is', () => {
    const result = gradeDoubtSignal(
      [
        { id: 'R1', zekerheid: 'hoog' },
        { id: 'R2', zekerheid: 'hoog' },
        { id: 'R3', zekerheid: 'laag' }
      ],
      { hardIds: HARD, field: 'zekerheid', lowValue: 'laag' }
    );
    assert.equal(result.pass, true);
    assert.equal(result.hardFlagged, 1);
    assert.equal(result.easyFlagged, 0);
  });

  test('KNOWN BAD: flagging nothing fails — a field nobody uses discloses nothing', () => {
    const result = gradeDoubtSignal(
      [
        { id: 'R1', zekerheid: 'hoog' },
        { id: 'R2', zekerheid: 'hoog' },
        { id: 'R3', zekerheid: 'hoog' }
      ],
      { hardIds: HARD, field: 'zekerheid', lowValue: 'laag' }
    );
    assert.equal(result.pass, false);
    assert.equal(result.hardFlagged, 0);
  });

  test('KNOWN BAD: flagging everything fails — a signal that never discriminates is noise', () => {
    const result = gradeDoubtSignal(
      [
        { id: 'R1', zekerheid: 'laag' },
        { id: 'R2', zekerheid: 'laag' },
        { id: 'R3', zekerheid: 'laag' }
      ],
      { hardIds: HARD, field: 'zekerheid', lowValue: 'laag' }
    );
    assert.equal(result.pass, false);
    assert.equal(result.easyFlagged, 2);
    assert.equal(result.separates, false);
  });

  test('KNOWN BAD: a missing confidence field is not a high-confidence answer', () => {
    const result = gradeDoubtSignal([{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }], {
      hardIds: HARD,
      field: 'zekerheid',
      lowValue: 'laag'
    });
    assert.equal(result.pass, false);
    assert.equal(result.missingField, 3);
  });
});
