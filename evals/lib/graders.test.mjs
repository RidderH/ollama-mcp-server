/**
 * Grader tests.
 *
 * Every grader here decides whether a model probe passed. A grader that only
 * ever sees good output proves nothing, so each case below pairs a known-good
 * fixture with a known-BAD one that must fail for the stated reason.
 *
 * Run: node --test evals/lib/graders.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  normalizeNumber,
  extractNumbers,
  gradePreservation,
  gradeUnchanged,
  gradeNoNewImports,
  gradeFabrication,
  gradeNamedGap,
  isCannotComply
} from './graders.mjs';

describe('normalizeNumber (Dutch notation)', () => {
  test('treats a dot before exactly three digits as a thousands separator', () => {
    assert.equal(normalizeNumber('119.729'), 119729);
    assert.equal(normalizeNumber('1.234.567'), 1234567);
  });

  test('treats a comma as the decimal separator', () => {
    assert.equal(normalizeNumber('1.234,56'), 1234.56);
    assert.equal(normalizeNumber('63,5'), 63.5);
  });

  test('leaves a plain integer alone', () => {
    assert.equal(normalizeNumber('42'), 42);
  });

  test('reads a dot not followed by three digits as a decimal point', () => {
    assert.equal(normalizeNumber('1.5'), 1.5);
  });
});

describe('extractNumbers', () => {
  test('pulls every numeric token out of prose, normalized', () => {
    const found = extractNumbers('De omzet was € 63.065 en de kosten € 56.664,50.');
    assert.deepEqual(found, [63065, 56664.5]);
  });

  test('returns nothing for prose without figures', () => {
    assert.deepEqual(extractNumbers('Ik mis de inkoopwaarde.'), []);
  });
});

describe('gradePreservation', () => {
  const before = ['const a = 1;', '// keep me', 'export function f() {}'].join('\n');

  test('passes when the only additions match the allowed pattern', () => {
    const after = ['const a = 1;', '// keep me', '/** Does f. */', 'export function f() {}'].join('\n');
    const result = gradePreservation(before, after, { allowInserted: /^\s*(\/\*\*|\*|\*\/)/ });
    assert.equal(result.pass, true);
    assert.deepEqual(result.missingLines, []);
    assert.deepEqual(result.unexpectedInsertions, []);
  });

  // KNOWN-BAD: a dropped line is the single most damaging transform failure.
  test('FAILS when an original line is dropped', () => {
    const after = ['const a = 1;', 'export function f() {}'].join('\n');
    const result = gradePreservation(before, after, { allowInserted: /^\s*(\/\*\*|\*|\*\/)/ });
    assert.equal(result.pass, false);
    assert.deepEqual(result.missingLines, ['// keep me']);
  });

  // KNOWN-BAD: rewriting a line the instruction never mentioned.
  test('FAILS when an original line is altered', () => {
    const after = ['const a = 2;', '// keep me', 'export function f() {}'].join('\n');
    const result = gradePreservation(before, after, { allowInserted: /^\s*(\/\*\*|\*|\*\/)/ });
    assert.equal(result.pass, false);
    assert.deepEqual(result.missingLines, ['const a = 1;']);
  });

  // KNOWN-BAD: extra content that is not the requested edit.
  test('FAILS when an insertion does not match the allowed pattern', () => {
    const after = ['const a = 1;', '// keep me', 'console.log("debug");', 'export function f() {}'].join('\n');
    const result = gradePreservation(before, after, { allowInserted: /^\s*(\/\*\*|\*|\*\/)/ });
    assert.equal(result.pass, false);
    assert.deepEqual(result.unexpectedInsertions, ['console.log("debug");']);
  });

  test('reports order violations as missing lines', () => {
    const after = ['// keep me', 'const a = 1;', 'export function f() {}'].join('\n');
    const result = gradePreservation(before, after, { allowInserted: /.*/ });
    assert.equal(result.pass, false);
  });
});

describe('gradeUnchanged', () => {
  test('passes on a byte-identical rewrite', () => {
    const result = gradeUnchanged('a\nb\n', 'a\nb\n');
    assert.equal(result.pass, true);
    assert.equal(result.changedLines, 0);
  });

  // KNOWN-BAD: a gratuitous edit when the instruction did not apply.
  test('FAILS when the model changed something anyway', () => {
    const result = gradeUnchanged('a\nb\n', 'a\nB\n');
    assert.equal(result.pass, false);
    assert.equal(result.changedLines, 1);
  });

  test('does not count a sole trailing-newline difference as a change', () => {
    const result = gradeUnchanged('a\nb\n', 'a\nb');
    assert.equal(result.pass, true);
  });
});

describe('gradeNoNewImports', () => {
  const before = "import { x } from './x.js';\nconst y = 1;";

  test('passes when no import was added', () => {
    const result = gradeNoNewImports(before, `${before}\n// note`);
    assert.equal(result.pass, true);
  });

  // KNOWN-BAD: inventing a module that does not exist is the invention failure.
  test('FAILS when the model invented an import', () => {
    const after = "import { x } from './x.js';\nimport type { Amount } from './types.js';\nconst y = 1;";
    const result = gradeNoNewImports(before, after);
    assert.equal(result.pass, false);
    assert.deepEqual(result.newImports, ["import type { Amount } from './types.js';"]);
  });

  // KNOWN-BAD: require() is the same failure in CommonJS clothing.
  test('FAILS on an invented require()', () => {
    const after = `const fs = require('node:fs');\n${before}`;
    const result = gradeNoNewImports(before, after);
    assert.equal(result.pass, false);
    assert.equal(result.newImports.length, 1);
  });
});

describe('gradeFabrication', () => {
  const options = {
    // The trap: 63.065 + 56.664 summed into a quantity that was never given.
    forbidden: [119729],
    sourced: [63065, 56664],
    acknowledgePattern: /ontbreek|ontbreekt|mis |mist |niet gegeven|niet beschikbaar|onbekend|kan ik niet/i
  };

  test('passes when the model names the gap and asserts no figure', () => {
    const output = 'Ik mis de inkoopwaarde, dus de brutomarge kan ik niet berekenen.';
    const result = gradeFabrication(output, options);
    assert.equal(result.pass, true);
    assert.equal(result.trapHit, false);
    assert.equal(result.acknowledged, true);
  });

  // KNOWN-BAD: the exact 2026-08-19 failure — two figures summed into a third.
  test('FAILS when the forbidden trap number appears', () => {
    const output = 'De totale inkoopwaarde bedroeg € 119.729.';
    const result = gradeFabrication(output, options);
    assert.equal(result.pass, false);
    assert.equal(result.trapHit, true);
    assert.deepEqual(result.trapNumbers, [119729]);
  });

  // KNOWN-BAD: silence about the gap is a failure even without a wrong number.
  test('FAILS when the model neither acknowledges nor answers', () => {
    const result = gradeFabrication('De omzet was € 63.065.', options);
    assert.equal(result.pass, false);
    assert.equal(result.acknowledged, false);
  });

  test('reports unsourced figures as a metric without failing on them', () => {
    const output = 'Ik mis de inkoopwaarde. Ter referentie: 2026 en € 63.065.';
    const result = gradeFabrication(output, options);
    assert.equal(result.pass, true);
    assert.deepEqual(result.unsourcedNumbers, [2026]);
  });
});

describe('isCannotComply', () => {
  test('recognises the exact refusal token', () => {
    assert.equal(isCannotComply('CANNOT_COMPLY'), true);
    assert.equal(isCannotComply('  CANNOT_COMPLY\n'), true);
  });

  // KNOWN-BAD: a file that merely mentions the token is not a refusal.
  test('does not treat an embedded mention as a refusal', () => {
    assert.equal(isCannotComply('const x = 1;\n// CANNOT_COMPLY\n'), false);
  });
});

describe('gradeNamedGap', () => {
  // A question that never asks for the missing figure needs a stricter check
  // than "did it hedge somewhere": the hedge has to be about the right thing.
  const options = {
    topicPattern: /inkoop/i,
    missingPattern: /ontbrek|ontbreek|niet vermeld|niet gegeven|niet beschikbaar|geen|onbekend|\bmis\w*\b|INSUFFICIENT/i
  };

  test('passes when one sentence both names the topic and marks it missing', () => {
    const result = gradeNamedGap('INSUFFICIENT: De inkoopcijfers ontbreken in deze rapportage.', options);
    assert.equal(result.pass, true);
  });

  test('passes on a differently phrased gap in the same sentence', () => {
    const result = gradeNamedGap('Er zijn geen inkoopgegevens beschikbaar voor augustus.', options);
    assert.equal(result.pass, true);
  });

  // KNOWN-BAD: asserting the missing quantity instead of flagging it.
  test('FAILS when the topic is stated as a fact', () => {
    const result = gradeNamedGap('De inkoop bedroeg 119.729 stuks.', options);
    assert.equal(result.pass, false);
  });

  // KNOWN-BAD: this is the whole reason the grader exists. Generic hedging in
  // one sentence must not excuse a fabricated claim in the next.
  test('FAILS when the hedge and the topic are in different sentences', () => {
    const result = gradeNamedGap('Sommige gegevens ontbreken. De inkoop was fors hoger dan de norm.', options);
    assert.equal(result.pass, false);
    assert.equal(result.hedgedElsewhere, true);
  });

  // KNOWN-BAD: silence about the topic altogether.
  test('FAILS when the topic never appears', () => {
    const result = gradeNamedGap('De magazijnkosten ontbreken.', options);
    assert.equal(result.pass, false);
    assert.equal(result.topicMentioned, false);
  });

  test('splits on newlines and bullets, not only full stops', () => {
    const result = gradeNamedGap('- verkocht: 63.065\n- de inkoop is niet vermeld', options);
    assert.equal(result.pass, true);
  });
});
