/**
 * Tests for the Dutch fidelity graders.
 *
 * Two things can go wrong with a Dutch answer and neither shows up in a value
 * check: a figure comes back anglicised (`1,245.50` for `1.245,50`, which
 * reads as a different number to a Dutch reader and to any parser tuned for
 * one), and the prose drifts into English somewhere past the opening
 * paragraph. Both graders get a known-BAD fixture per failure.
 *
 * Run: node --test evals/lib/dutch.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeNumberEcho, gradeDutchLanguage } from './dutch.mjs';

describe('gradeNumberEcho', () => {
  const EXPECTED = ['1.245,50', '63.065', '890,00'];

  test('accepts figures echoed exactly as written', () => {
    const result = gradeNumberEcho('De omzet was € 1.245,50 op 63.065 stuks, kosten € 890,00.', EXPECTED);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.exact.length, 3);
  });

  test('accepts an unformatted but Dutch rendering, and says it was reformatted', () => {
    const result = gradeNumberEcho('De omzet was € 1245,50 op 63065 stuks, kosten € 890,00.', EXPECTED);
    assert.equal(result.pass, true);
    assert.deepEqual(result.reformatted.map((r) => r.expected).sort(), ['1.245,50', '63.065']);
  });

  test('KNOWN BAD: an anglicised decimal fails — 1,245.50 is not 1.245,50', () => {
    const result = gradeNumberEcho('De omzet was € 1,245.50 op 63.065 stuks, kosten € 890,00.', EXPECTED);
    assert.equal(result.pass, false);
    assert.equal(result.anglicised[0].expected, '1.245,50');
    assert.equal(result.anglicised[0].found, '1,245.50');
  });

  test('KNOWN BAD: a decimal point where a comma belongs fails', () => {
    const result = gradeNumberEcho('De omzet was € 1245.50 op 63.065 stuks, kosten € 890,00.', EXPECTED);
    assert.equal(result.pass, false);
    assert.equal(result.anglicised[0].found, '1245.50');
  });

  test('KNOWN BAD: a figure that never appears at all fails as missing, not as mangled', () => {
    const result = gradeNumberEcho('De omzet was € 1.245,50 en verder niets bijzonders.', EXPECTED);
    assert.equal(result.pass, false);
    assert.deepEqual(result.missing.sort(), ['63.065', '890,00']);
    assert.equal(result.anglicised.length, 0);
  });

  test('KNOWN BAD: a wrong value is missing, however Dutch it looks', () => {
    const result = gradeNumberEcho('De omzet was € 1.245,55 op 63.065 stuks, kosten € 890,00.', EXPECTED);
    assert.equal(result.pass, false);
    assert.deepEqual(result.missing, ['1.245,50']);
  });

  test('a thousands separator dropped from a whole number is a reformat, not a break', () => {
    const result = gradeNumberEcho('63065 stuks', ['63.065']);
    assert.equal(result.pass, true);
    assert.equal(result.reformatted.length, 1);
  });
});

describe('gradeDutchLanguage', () => {
  test('accepts Dutch prose, including words English shares', () => {
    const text = 'Dit is de omzet over augustus. Wat opvalt is dat de kosten in die maand hoger waren.';
    const result = gradeDutchLanguage(text);
    assert.equal(result.pass, true, JSON.stringify(result.englishWords));
  });

  test('KNOWN BAD: an English sentence is caught', () => {
    const result = gradeDutchLanguage('De omzet steeg. The revenue for this month is higher than before.');
    assert.equal(result.pass, false);
    assert.ok(result.englishWords.includes('the'));
    assert.ok(result.englishWords.includes('than'));
  });

  test('KNOWN BAD: drifting only at the end is still drift, and the position is reported', () => {
    const dutch = 'De omzet steeg in augustus met vier procent. '.repeat(20);
    const result = gradeDutchLanguage(`${dutch}In conclusion, these figures are within the expected range.`);
    assert.equal(result.pass, false);
    assert.ok(result.firstDriftAt > 0.8, `drift should be reported near the end, got ${result.firstDriftAt}`);
  });

  test('does not flag Dutch words that merely look English', () => {
    // "is", "die", "dat", "over", "in", "was", "we", "of", "me", "men", "hen"
    // are all Dutch. A grader that flags them reports drift on every answer.
    const result = gradeDutchLanguage('Het bedrag dat we in die maand over hadden was hoger dan verwacht.');
    assert.equal(result.pass, true, JSON.stringify(result.englishWords));
  });
});
