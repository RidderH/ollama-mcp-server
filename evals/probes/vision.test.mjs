/**
 * Guard for the vision probe's pass rule.
 *
 * The rule this file exists to protect is the one distinguishing a cell that
 * was READ from one that was INFERRED. Every figure on the invoice except two
 * is derivable from the others by multiplication, so a model that never looked
 * at the regeltotaal column can still score 28 of 30 cells. If the grader does
 * not separate those two cells out, that model looks like a good one.
 *
 * Run: node --test evals/probes/vision.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeVision } from './vision.mjs';

const ROWS = [
  { code: 'A-100', aantal: 4, stukprijs: 445.5, btwPercentage: 21, regeltotaal: 1782 },
  { code: 'A-210', aantal: 4, stukprijs: 189.95, btwPercentage: 21, regeltotaal: 759.8 },
  { code: 'B-045', aantal: 12, stukprijs: 34.25, btwPercentage: 21, regeltotaal: 411 },
  { code: 'C-330', aantal: 6, stukprijs: 27.9, btwPercentage: 9, regeltotaal: 167.4 },
  { code: 'D-012', aantal: 1, stukprijs: 95, btwPercentage: 21, regeltotaal: 85 },
  { code: 'E-777', aantal: 8, stukprijs: 62.5, btwPercentage: 21, regeltotaal: 500 }
];

const answer = (rows, totaal = 3705.2) => JSON.stringify({ regels: rows, totaalExclBtw: totaal });
const edit = (code, patch) => ROWS.map((row) => (row.code === code ? { ...row, ...patch } : row));

describe('gradeVision', () => {
  test('every cell as printed passes', () => {
    const result = gradeVision(answer(ROWS));
    assert.equal(result.pass, true, JSON.stringify(result.detail));
    assert.equal(result.detail.cellsWrong, 0);
  });

  test('rows in a different order still pass — they are keyed by code', () => {
    const result = gradeVision(answer([...ROWS].reverse()));
    assert.equal(result.pass, true, JSON.stringify(result.detail));
  });

  test('KNOWN BAD: the discount row computed instead of read is flagged as inferred, not misread', () => {
    // 1 x 95,00 = 95,00, which is what a model that multiplies will write. The
    // invoice prints 85,00. This is the whole reason that row exists.
    const result = gradeVision(answer(edit('D-012', { regeltotaal: 95 }), 3715.2));
    assert.equal(result.pass, false);
    assert.equal(result.detail.misreadCells.length, 0, 'no cell was misread — every one is plausible');
    assert.deepEqual(
      result.detail.inferredNotRead.map((m) => m.path).sort(),
      ['regels.D-012.regeltotaal', 'totaalExclBtw']
    );
  });

  test('KNOWN BAD: a value taken from the neighbouring column is a misread, and is named', () => {
    // btw 21 read into the aantal cell: the shape stays valid and the number
    // is one that appears on the page, which is what makes it plausible.
    const result = gradeVision(answer(edit('C-330', { aantal: 9 })));
    assert.equal(result.pass, false);
    assert.equal(result.detail.misreadCells[0].path, 'regels.C-330.aantal');
    assert.equal(result.detail.inferredNotRead.length, 0);
  });

  test('KNOWN BAD: a dropped row is reported as a missing code, not as wrong cells', () => {
    const result = gradeVision(answer(ROWS.filter((row) => row.code !== 'B-045')));
    assert.equal(result.pass, false);
    assert.deepEqual(result.detail.missingCodes, ['B-045']);
  });

  test('KNOWN BAD: an invented row is reported', () => {
    const rows = [...ROWS, { code: 'F-999', aantal: 1, stukprijs: 10, btwPercentage: 21, regeltotaal: 10 }];
    const result = gradeVision(answer(rows));
    assert.equal(result.pass, false);
    assert.deepEqual(result.detail.extraCodes, ['F-999']);
  });

  test('KNOWN BAD: a Dutch-notation string where a number belongs fails on the schema', () => {
    const result = gradeVision(answer(edit('A-100', { stukprijs: '445,50' })));
    assert.equal(result.pass, false);
    assert.equal(result.detail.schemaValid, false);
  });

  test('KNOWN BAD: prose instead of JSON fails at the first axis', () => {
    const result = gradeVision('De factuur bevat zes regels met een totaal van € 3.705,20.');
    assert.equal(result.pass, false);
    assert.equal(result.detail.isJson, false);
  });
});
