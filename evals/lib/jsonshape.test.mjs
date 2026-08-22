/**
 * Tests for the structured-output graders.
 *
 * These decide whether a probe answering in JSON passed, so each one pairs a
 * known-good input with a known-BAD one that must fail for the stated reason.
 * A grader only ever seen passing proves nothing about the run where the model
 * misbehaves — which is the run these exist for.
 *
 * Run: node --test evals/lib/jsonshape.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { parseJsonOutput, validateSchema, compareValues } from './jsonshape.mjs';

describe('parseJsonOutput — how much work a caller must do', () => {
  test('bare JSON parses at the raw level', () => {
    const result = parseJsonOutput('{"a": 1}');
    assert.equal(result.level, 'raw');
    assert.equal(result.parsesRaw, true);
    assert.equal(result.fenced, false);
    assert.deepEqual(result.value, { a: 1 });
  });

  test('a fenced answer needs the fence stripped — a naive JSON.parse fails', () => {
    const result = parseJsonOutput('```json\n{"a": 1}\n```');
    assert.equal(result.parsesRaw, false, 'raw JSON.parse must fail on a fenced answer');
    assert.equal(result.level, 'stripped');
    assert.equal(result.fenced, true);
    assert.deepEqual(result.value, { a: 1 });
  });

  test('prose around the JSON needs a brace scan — fence stripping is not enough', () => {
    const result = parseJsonOutput('Hier is het resultaat:\n\n{"a": 1}\n\nKlaar.');
    assert.equal(result.parsesRaw, false);
    assert.equal(result.parsesStripped, false);
    assert.equal(result.level, 'scanned');
    assert.deepEqual(result.value, { a: 1 });
  });

  test('the brace scan respects braces inside strings', () => {
    const result = parseJsonOutput('praat\n{"a": "een { in een string"}\nnog meer');
    assert.equal(result.level, 'scanned');
    assert.deepEqual(result.value, { a: 'een { in een string' });
  });

  test('KNOWN BAD: prose with no JSON at all fails at every level', () => {
    const result = parseJsonOutput('INSUFFICIENT: ik mis de betaaldatum.');
    assert.equal(result.parsesRaw, false);
    assert.equal(result.parsesStripped, false);
    assert.equal(result.parsesScanned, false);
    assert.equal(result.level, 'none');
    assert.equal(result.value, undefined);
    assert.ok(result.error, 'a total failure must carry an error to report');
  });

  test('KNOWN BAD: truncated JSON does not parse at any level', () => {
    const result = parseJsonOutput('{"a": 1, "b": [1, 2');
    assert.equal(result.level, 'none');
  });

  test('a top-level array counts as JSON', () => {
    const result = parseJsonOutput('[1, 2, 3]');
    assert.equal(result.level, 'raw');
    assert.deepEqual(result.value, [1, 2, 3]);
  });
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nummer', 'status', 'betaaldatum'],
  properties: {
    nummer: { type: 'string' },
    bedrag: { type: 'number' },
    status: { type: 'string', enum: ['betaald', 'open', 'overig'] },
    betaaldatum: { type: ['string', 'null'] }
  }
};

describe('validateSchema', () => {
  test('accepts a conforming object', () => {
    const result = validateSchema(
      { nummer: 'F-1', bedrag: 12.5, status: 'open', betaaldatum: null },
      SCHEMA
    );
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  test('KNOWN BAD: a missing required field fails and is named', () => {
    const result = validateSchema({ nummer: 'F-1', status: 'open' }, SCHEMA);
    assert.equal(result.pass, false);
    assert.ok(result.errors.some((e) => e.includes('betaaldatum')), result.errors.join('; '));
  });

  test('KNOWN BAD: a value outside the enum fails — the invented-category case', () => {
    const result = validateSchema(
      { nummer: 'F-1', status: 'deels betaald', betaaldatum: null },
      SCHEMA
    );
    assert.equal(result.pass, false);
    assert.ok(result.errors.some((e) => /enum/.test(e)), result.errors.join('; '));
  });

  test('KNOWN BAD: a number sent as a string fails — "1.245,50" is not a number', () => {
    const result = validateSchema(
      { nummer: 'F-1', bedrag: '1.245,50', status: 'open', betaaldatum: null },
      SCHEMA
    );
    assert.equal(result.pass, false);
    assert.ok(result.errors.some((e) => e.includes('bedrag')), result.errors.join('; '));
  });

  test('KNOWN BAD: an extra key fails when additionalProperties is false', () => {
    const result = validateSchema(
      { nummer: 'F-1', status: 'open', betaaldatum: null, opmerking: 'zie mail' },
      SCHEMA
    );
    assert.equal(result.pass, false);
    assert.ok(result.errors.some((e) => e.includes('opmerking')), result.errors.join('; '));
  });

  test('KNOWN BAD: null in a field that is not nullable fails', () => {
    const result = validateSchema(
      { nummer: null, status: 'open', betaaldatum: null },
      SCHEMA
    );
    assert.equal(result.pass, false);
    assert.ok(result.errors.some((e) => e.includes('nummer')), result.errors.join('; '));
  });

  test('KNOWN BAD: an array where an object belongs fails', () => {
    const result = validateSchema([{ nummer: 'F-1' }], SCHEMA);
    assert.equal(result.pass, false);
  });

  test('validates every element of an array, and names the index', () => {
    const listSchema = { type: 'array', items: SCHEMA };
    const good = validateSchema(
      [{ nummer: 'F-1', status: 'open', betaaldatum: null }],
      listSchema
    );
    assert.equal(good.pass, true, JSON.stringify(good.errors));

    const bad = validateSchema(
      [
        { nummer: 'F-1', status: 'open', betaaldatum: null },
        { nummer: 'F-2', status: 'verzonnen', betaaldatum: null }
      ],
      listSchema
    );
    assert.equal(bad.pass, false);
    assert.ok(bad.errors.some((e) => e.includes('[1]')), bad.errors.join('; '));
  });

  test('reports every failure, not just the first', () => {
    const result = validateSchema({ nummer: 7, status: 'verzonnen' }, SCHEMA);
    assert.ok(result.errors.length >= 3, result.errors.join('; '));
  });
});

describe('compareValues — right shape, wrong values', () => {
  test('accepts an exact match', () => {
    const result = compareValues({ a: 1, b: 'x' }, { a: 1, b: 'x' });
    assert.equal(result.pass, true);
  });

  test('ignores keys the ground truth does not mention — shape is judged elsewhere', () => {
    const result = compareValues({ a: 1, extra: 'whatever' }, { a: 1 });
    assert.equal(result.pass, true);
  });

  test('accepts a float within tolerance — 4901.45 is not 4901.4499999', () => {
    const result = compareValues({ totaal: 4901.4499999 }, { totaal: 4901.45 });
    assert.equal(result.pass, true);
  });

  test('KNOWN BAD: a wrong number fails and reports its path', () => {
    const result = compareValues({ totaal: 4446.25 }, { totaal: 4901.45 });
    assert.equal(result.pass, false);
    assert.equal(result.mismatches[0].path, 'totaal');
    assert.equal(result.mismatches[0].expected, 4901.45);
    assert.equal(result.mismatches[0].actual, 4446.25);
  });

  test('KNOWN BAD: an invented date where null belongs fails', () => {
    const result = compareValues({ betaaldatum: '2026-08-31' }, { betaaldatum: null });
    assert.equal(result.pass, false);
    assert.equal(result.mismatches[0].path, 'betaaldatum');
  });

  test('KNOWN BAD: a missing nested key fails, named by its full path', () => {
    const result = compareValues({ order: {} }, { order: { nummer: 'F-1' } });
    assert.equal(result.pass, false);
    assert.equal(result.mismatches[0].path, 'order.nummer');
  });

  test('KNOWN BAD: a short array fails — a dropped row is the quiet failure', () => {
    const result = compareValues({ regels: [1, 2] }, { regels: [1, 2, 3] });
    assert.equal(result.pass, false);
    assert.ok(result.mismatches.some((m) => m.path === 'regels.length'), JSON.stringify(result.mismatches));
  });

  test('KNOWN BAD: a wrong element inside an array is named by index', () => {
    const result = compareValues(
      { regels: [{ status: 'betaald' }, { status: 'betaald' }] },
      { regels: [{ status: 'betaald' }, { status: 'open' }] }
    );
    assert.equal(result.pass, false);
    assert.equal(result.mismatches[0].path, 'regels[1].status');
  });

  test('KNOWN BAD: a number sent as a Dutch string is not equal to the number', () => {
    const result = compareValues({ bedrag: '1.245,50' }, { bedrag: 1245.5 });
    assert.equal(result.pass, false);
  });
});
