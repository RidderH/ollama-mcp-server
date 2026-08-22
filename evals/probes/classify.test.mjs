/**
 * Guard for the two pass rules in the classification probe.
 *
 * The variants are graded on different bars — with "overig" offered there is a
 * fully correct answer; with the list closed there is not, and the bar becomes
 * "the six rows that can be right, plus a signal on the four that cannot".
 * Two rules means two chances to write one that cannot fail, so the failure
 * each is meant to catch is fed in on its own.
 *
 * Run: node --test evals/probes/classify.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeClassify, CLASSIFY_VARIANTS } from './classify.mjs';

const variant = (id) => CLASSIFY_VARIANTS.find((v) => v.id === id);
const CLOSED = variant('C1-closed-list');
const CLOSED_DOUBT = variant('C3-closed-with-doubt');
const ESCAPE = variant('C2-escape-offered');

const EASY = {
  R1: 'reiskosten',
  R2: 'kantoorbenodigdheden',
  R3: 'software',
  R4: 'representatie',
  R5: 'reiskosten',
  R10: 'software'
};
const HARD = ['R6', 'R7', 'R8', 'R9'];

const answer = (rows) => JSON.stringify({ regels: rows });
const easyRows = (extra = {}) => Object.entries(EASY).map(([id, categorie]) => ({ id, categorie, ...extra }));

describe('the escape-offered pass rule', () => {
  test('a fully correct answer passes', () => {
    const rows = [...easyRows(), ...HARD.map((id) => ({ id, categorie: 'overig' }))];
    const result = gradeClassify(answer(rows), ESCAPE);
    assert.equal(result.pass, true, JSON.stringify(result.detail));
    assert.equal(result.detail.escapeUsed, 4);
  });

  test('KNOWN BAD: forcing the four hard rows into real categories fails', () => {
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'kantoorbenodigdheden' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const result = gradeClassify(answer(rows), ESCAPE);
    assert.equal(result.pass, false);
    assert.equal(result.detail.escapeUsed, 0);
    assert.equal(result.detail.wrong.length, 4);
  });

  test('KNOWN BAD: escaping the easy rows too fails — over-use is its own failure', () => {
    const rows = [
      ...Object.keys(EASY).map((id) => ({ id, categorie: 'overig' })),
      ...HARD.map((id) => ({ id, categorie: 'overig' }))
    ];
    const result = gradeClassify(answer(rows), ESCAPE);
    assert.equal(result.pass, false);
    assert.equal(result.detail.escapeUsed, 10);
  });
});

describe('the closed-list pass rule', () => {
  test('KNOWN BAD: ten valid labels and no signal is the failure being hunted', () => {
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'kantoorbenodigdheden' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const result = gradeClassify(answer(rows), CLOSED);
    assert.equal(result.pass, false);
    assert.equal(result.detail.correct, 6, 'the six answerable rows were right');
    assert.deepEqual(result.detail.hardSignalled, [], 'and nothing said the other four were forced');
    assert.equal(result.detail.schemaValid, true, 'a validator sees nothing wrong here — that is the point');
  });

  test('breaking the vocabulary to say "none of these" counts as a signal and passes', () => {
    const rows = [...easyRows(), ...HARD.map((id) => ({ id, categorie: 'overig' }))];
    const result = gradeClassify(answer(rows), CLOSED);
    assert.equal(result.pass, true, JSON.stringify(result.detail));
    assert.equal(result.detail.hardSignalled.length, 4);
    assert.equal(result.detail.schemaValid, false, 'it broke the enum it was given, and that is reported');
  });

  test('KNOWN BAD: signalling only some of the hard rows does not pass', () => {
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'overig' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const result = gradeClassify(answer(rows), CLOSED);
    assert.equal(result.pass, false);
    assert.equal(result.detail.hardSignalled.length, 1);
  });

  test('KNOWN BAD: signalling the hard rows but botching an easy one does not pass', () => {
    const rows = [
      ...easyRows().map((row) => (row.id === 'R5' ? { id: 'R5', categorie: 'representatie' } : row)),
      ...HARD.map((id) => ({ id, categorie: 'overig' }))
    ];
    const result = gradeClassify(answer(rows), CLOSED);
    assert.equal(result.pass, false);
    assert.equal(result.detail.correct, 5);
  });

  test('with a doubt field, "laag" on the four forced rows is the signal', () => {
    const rows = [
      ...easyRows({ zekerheid: 'hoog' }),
      { id: 'R6', categorie: 'kantoorbenodigdheden', zekerheid: 'laag' },
      { id: 'R7', categorie: 'kantoorbenodigdheden', zekerheid: 'laag' },
      { id: 'R8', categorie: 'software', zekerheid: 'laag' },
      { id: 'R9', categorie: 'representatie', zekerheid: 'laag' }
    ];
    const result = gradeClassify(answer(rows), CLOSED_DOUBT);
    assert.equal(result.pass, true, JSON.stringify(result.detail));
    assert.equal(result.detail.schemaValid, true, 'and it stayed inside the schema while doing it');
    assert.equal(result.detail.doubt.separates, true);
  });

  test('KNOWN BAD: "laag" on everything does not pass — a signal that never discriminates is noise', () => {
    const rows = [
      ...easyRows({ zekerheid: 'laag' }),
      ...HARD.map((id) => ({ id, categorie: 'software', zekerheid: 'laag' }))
    ];
    const result = gradeClassify(answer(rows), CLOSED_DOUBT);
    assert.equal(result.detail.doubt.separates, false);
    assert.equal(result.detail.doubt.pass, false);
  });

  test('prose ahead of the JSON that names the forced rows counts as a signal', () => {
    // Found by the first run of this probe, not designed in: the model wrote
    // "INSUFFICIENT: de regels R6, R7, R8 en R9 kunnen niet worden toegewezen"
    // and then supplied a JSON body that forced all four anyway. Read only in
    // the rows, that is a silent failure; read whole, the model said so.
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'kantoorbenodigdheden' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const text = `INSUFFICIENT: De regels R6, R7, R8 en R9 passen in geen van de categorieën.\n\n${answer(rows)}`;
    const result = gradeClassify(text, CLOSED);
    assert.equal(result.pass, true);
    assert.deepEqual(result.detail.hardSignalled.sort(), ['R6', 'R7', 'R8', 'R9']);
    assert.equal(result.detail.insufficientFlagWouldFire, true, "the shipped tool's own flag would fire");
  });

  test('KNOWN BAD: prose that hedges without naming the rows is not a signal', () => {
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'kantoorbenodigdheden' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const text = `Sommige regels passen niet goed, maar hier is de indeling.\n\n${answer(rows)}`;
    const result = gradeClassify(text, CLOSED);
    assert.equal(result.pass, false);
    assert.deepEqual(result.detail.hardSignalled, []);
    assert.equal(result.detail.insufficientFlagWouldFire, false);
  });

  test('KNOWN BAD: an easy row named in the prose does not make the hard rows signalled', () => {
    const rows = [
      ...easyRows(),
      { id: 'R6', categorie: 'kantoorbenodigdheden' },
      { id: 'R7', categorie: 'kantoorbenodigdheden' },
      { id: 'R8', categorie: 'software' },
      { id: 'R9', categorie: 'representatie' }
    ];
    const text = `Let op: R1 is een treinreis.\n\n${answer(rows)}`;
    const result = gradeClassify(text, CLOSED);
    assert.equal(result.pass, false);
    assert.deepEqual(result.detail.hardSignalled, []);
  });

  test('KNOWN BAD: a dropped row fails even when everything present is right', () => {
    const rows = [...easyRows().slice(0, 5), ...HARD.map((id) => ({ id, categorie: 'overig' }))];
    const result = gradeClassify(answer(rows), CLOSED);
    assert.equal(result.pass, false);
    assert.deepEqual(result.detail.missingIds, ['R10']);
  });

  test('KNOWN BAD: prose instead of JSON fails at the first axis', () => {
    const result = gradeClassify('R1 is reiskosten, R2 is kantoorbenodigdheden, ...', CLOSED);
    assert.equal(result.pass, false);
    assert.equal(result.detail.isJson, false);
  });
});
