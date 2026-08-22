/**
 * Guards on the multi-fact grader.
 *
 * The whole point of this probe is attribution: an answer can be wrong because
 * a figure was not found in the corpus, or because five found figures were
 * added up badly, and those two send work to different places. A grader that
 * only says "wrong" would leave the finding unwritable, so every KNOWN BAD
 * here asserts *which* of the two it names.
 *
 * Run: node --test evals/lib/multifact.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeMultiFact, MULTIFACT_SCHEMA } from './multifact.mjs';

const NEEDLES = [
  { plaats: 'Zwolle', zendingen: 4128 },
  { plaats: 'Franeker', zendingen: 2769 },
  { plaats: 'Harderwijk', zendingen: 6314 }
];
const TOTAL = 4128 + 2769 + 6314;

const answer = (rows, totaal) => JSON.stringify({ vestigingen: rows, totaal });
const perfect = () => answer(NEEDLES.map((n) => ({ ...n })), TOTAL);

describe('gradeMultiFact', () => {
  test('every figure as printed, and the total, passes', () => {
    const graded = gradeMultiFact(perfect(), NEEDLES);
    assert.equal(graded.pass, true);
    assert.equal(graded.detail.recall, 3);
    assert.equal(graded.detail.totalExact, true);
    assert.deepEqual(graded.detail.missing, []);
    assert.deepEqual(graded.detail.misread, []);
  });

  test('rows in a different order still pass — they are keyed by city', () => {
    const rows = [...NEEDLES].reverse().map((n) => ({ ...n }));
    assert.equal(gradeMultiFact(answer(rows, TOTAL), NEEDLES).pass, true);
  });

  test('a Dutch-notation figure is read as the number it is', () => {
    const rows = NEEDLES.map((n) => ({ ...n, zendingen: n.zendingen }));
    rows[0].zendingen = 4128;
    assert.equal(gradeMultiFact(answer(rows, TOTAL), NEEDLES).detail.recall, 3);
  });

  // Attribution case 1: it read one branch wrong, then added up its own
  // numbers correctly. The fault is retrieval, and the arithmetic is fine.
  test('KNOWN BAD: one misread figure with a self-consistent total is a recall failure, not an arithmetic one', () => {
    const rows = NEEDLES.map((n) => ({ ...n }));
    rows[1].zendingen = 2679;
    const graded = gradeMultiFact(answer(rows, 4128 + 2679 + 6314), NEEDLES);
    assert.equal(graded.pass, false);
    assert.equal(graded.detail.recall, 2);
    assert.deepEqual(graded.detail.misread, [{ plaats: 'Franeker', expected: 2769, reported: 2679 }]);
    assert.equal(graded.detail.totalExact, false);
    assert.equal(graded.detail.arithmeticConsistent, true, 'it did add up what it reported');
  });

  // Attribution case 2: it found all three and still got the sum wrong. The
  // fault is arithmetic, and no amount of prompt shortening would fix it.
  test('KNOWN BAD: five right figures and a wrong total is an arithmetic failure, not a recall one', () => {
    const graded = gradeMultiFact(answer(NEEDLES.map((n) => ({ ...n })), TOTAL + 100), NEEDLES);
    assert.equal(graded.pass, false);
    assert.equal(graded.detail.recall, 3, 'recall was perfect');
    assert.deepEqual(graded.detail.misread, []);
    assert.equal(graded.detail.totalExact, false);
    assert.equal(graded.detail.arithmeticConsistent, false);
  });

  test('KNOWN BAD: a dropped city is reported as missing, not as a misread', () => {
    const rows = NEEDLES.slice(0, 2).map((n) => ({ ...n }));
    const graded = gradeMultiFact(answer(rows, 4128 + 2769), NEEDLES);
    assert.equal(graded.pass, false);
    assert.equal(graded.detail.recall, 2);
    assert.deepEqual(graded.detail.missing, ['Harderwijk']);
    assert.deepEqual(graded.detail.misread, []);
  });

  test('KNOWN BAD: a city nobody asked about is reported as an extra', () => {
    const rows = [...NEEDLES.map((n) => ({ ...n })), { plaats: 'Sneek', zendingen: 3300 }];
    const graded = gradeMultiFact(answer(rows, TOTAL), NEEDLES);
    assert.equal(graded.pass, false);
    assert.deepEqual(graded.detail.extra, ['Sneek']);
  });

  test('KNOWN BAD: prose instead of JSON fails at the first axis', () => {
    const graded = gradeMultiFact('Het totaal is 13.211 zendingen.', NEEDLES);
    assert.equal(graded.pass, false);
    assert.equal(graded.detail.isJson, false);
    assert.equal(graded.detail.recall, 0);
  });

  test('KNOWN BAD: a figure sent as a string fails on the schema', () => {
    const rows = NEEDLES.map((n) => ({ ...n }));
    rows[0].zendingen = '4.128';
    const graded = gradeMultiFact(answer(rows, TOTAL), NEEDLES);
    assert.equal(graded.pass, false);
    assert.equal(graded.detail.schemaValid, false);
  });

  test('KNOWN BAD: a fenced answer still parses, and the fence is reported', () => {
    const graded = gradeMultiFact(`\`\`\`json\n${perfect()}\n\`\`\``, NEEDLES);
    assert.equal(graded.pass, true);
    assert.equal(graded.detail.fenced, true);
    assert.equal(graded.detail.parseLevel, 'stripped');
  });

  test('the schema it grades against is the schema the probe pastes into the prompt', () => {
    assert.deepEqual(MULTIFACT_SCHEMA.required, ['vestigingen', 'totaal']);
    assert.equal(MULTIFACT_SCHEMA.properties.vestigingen.items.properties.zendingen.type, 'integer');
  });
});
