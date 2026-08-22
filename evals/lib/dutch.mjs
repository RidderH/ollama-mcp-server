/**
 * Graders for Dutch fidelity.
 *
 * The user works in Dutch, so two failures matter that a value-level check
 * cannot see. A figure can come back anglicised — `1,245.50` where the source
 * wrote `1.245,50` — which is the same quantity to nobody: a Dutch reader sees
 * a thousand-and-a-bit written wrongly, and a parser tuned for Dutch reads it
 * as one-point-two-four-five. And prose can start in Dutch and finish in
 * English, which is invisible if only the first paragraph is read.
 */

import { normalizeNumber } from './graders.mjs';

/** Every numeric token in a text, with the literal that produced it. */
function numericTokens(text) {
  return (String(text).match(/\d+(?:[.,]\d+)*/g) ?? []).map((literal) => ({
    literal,
    value: normalizeNumber(literal)
  }));
}

/**
 * Is this literal written the Dutch way?
 *
 * Dutch groups thousands with a dot in threes and takes a comma for the
 * decimal: `1.245,50`, `63.065`, `890,00`, and an ungrouped `1245,50`. The
 * ambiguity worth naming is `1.245` — a valid Dutch thousands group, and also
 * how English writes one and a quarter. It counts as Dutch here, and the
 * caller's expected value settles which number was meant.
 */
function isDutchNotation(literal) {
  return /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(literal) || /^\d+(,\d+)?$/.test(literal);
}

/**
 * Is this literal the expected number written the English way?
 *
 * A dot ahead of anything but a thousands group is the tell, because Dutch
 * never uses one as a decimal point — `1245.50` is anglicised even though
 * reading it as English yields exactly the right quantity. That is the whole
 * failure: right value, wrong notation, and no parser downstream to notice.
 */
function looksAnglicised(literal, expectedValue) {
  if (isDutchNotation(literal)) return false;
  return Number.parseFloat(literal.replace(/,/g, '')) === expectedValue;
}

/**
 * Did every figure survive the round trip, and in Dutch notation?
 *
 * Three outcomes are kept apart because they mean different things: echoed
 * exactly, echoed as a different but still Dutch rendering (`1245,50` for
 * `1.245,50` — cosmetic), and echoed anglicised (a break). A figure that never
 * appears is missing rather than mangled, and that distinction matters: one is
 * a formatting fault, the other is a dropped fact.
 */
export function gradeNumberEcho(text, expectedLiterals) {
  const tokens = numericTokens(text);
  const exact = [];
  const reformatted = [];
  const anglicised = [];
  const missing = [];

  for (const expected of expectedLiterals) {
    const expectedValue = normalizeNumber(expected);

    // Anchored so the literal is not merely part of a longer number, while
    // still matching one that ends a sentence: "€ 890,00." is an exact echo.
    const literal = expected.replace(/[.]/g, '\\.');
    if (new RegExp(`(?<![\\d.,])${literal}(?!\\d)(?![.,]\\d)`).test(String(text))) {
      exact.push(expected);
      continue;
    }

    const anglicisedHit = tokens.find((token) => looksAnglicised(token.literal, expectedValue));
    if (anglicisedHit !== undefined) {
      anglicised.push({ expected, found: anglicisedHit.literal });
      continue;
    }

    const sameValue = tokens.find((token) => token.value === expectedValue);
    if (sameValue !== undefined) {
      reformatted.push({ expected, found: sameValue.literal });
      continue;
    }

    missing.push(expected);
  }

  return {
    pass: anglicised.length === 0 && missing.length === 0,
    exact,
    reformatted,
    anglicised,
    missing
  };
}

/**
 * Words that exist in English and not in Dutch.
 *
 * The list is short on purpose. Dutch shares an alarming number of short words
 * with English — is, dat, die, over, in, was, we, of, men, hen, ben, hier —
 * and a grader that includes any of them reports drift on every answer written
 * in perfect Dutch. That was measured, not guessed: a first pass using "is",
 * "and", "the" flagged 9 answers, and all nine were false.
 */
const ENGLISH_ONLY =
  /\b(the|and|with|this|which|from|should|would|because|however|therefore|these|those|there|are|will|have|has|been|being|each|both|other|only|also|more|than|then|such|between|through|about|after|before|while|where|what|value|amount|total|revenue|costs|month|invoice|conclusion|expected|range|figures|higher|within)\b/gi;

/**
 * Did the answer stay in Dutch from beginning to end?
 *
 * `firstDriftAt` is the position of the first English word as a fraction of
 * the text, because drift that begins two thirds of the way in is the case
 * worth knowing about — the opening reads fine, so a spot check passes.
 */
export function gradeDutchLanguage(text) {
  const body = String(text);
  const matches = [...body.matchAll(ENGLISH_ONLY)];
  const englishWords = [...new Set(matches.map((match) => match[0].toLowerCase()))];

  return {
    pass: matches.length === 0,
    englishWords,
    englishCount: matches.length,
    firstDriftAt: matches.length === 0 ? undefined : matches[0].index / Math.max(body.length, 1),
    length: body.length
  };
}
