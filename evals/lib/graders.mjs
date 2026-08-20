/**
 * Deterministic graders for the model probes.
 *
 * Nothing here calls a model or eyeballs output. Each function takes a probe's
 * raw text plus a ground-truth fixture and returns a verdict a script can act
 * on, so a probe result means the same thing on every run and to every reader.
 */

/**
 * Read a number written the Dutch way.
 *
 * `1.234,56` is one thousand two hundred and thirty-four; `1.5` is one and a
 * half. The separator is decided by what follows it: a dot before exactly
 * three digits groups thousands, anything else is a decimal point.
 */
export function normalizeNumber(token) {
  const cleaned = String(token).replace(/\s/g, '');

  if (cleaned.includes(',')) {
    return Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }

  const parts = cleaned.split('.');
  if (parts.length > 1) {
    const groupsAreThousands = parts.slice(1).every((part) => /^\d{3}$/.test(part));
    if (groupsAreThousands) return Number.parseFloat(parts.join(''));
  }

  return Number.parseFloat(cleaned);
}

/** Every distinct numeric token in a piece of prose, normalized, in order. */
export function extractNumbers(text) {
  const matches = String(text).match(/\d+(?:[.,]\d+)*/g) ?? [];
  const seen = new Set();
  const numbers = [];
  for (const match of matches) {
    const value = normalizeNumber(match);
    if (Number.isNaN(value) || seen.has(value)) continue;
    seen.add(value);
    numbers.push(value);
  }
  return numbers;
}

/** Longest common subsequence of two line arrays, as index pairs. */
function lcsPairs(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Did the rewrite keep every original line, in order, and add only what the
 * instruction asked for?
 *
 * `allowInserted` describes the lines the instruction legitimately introduces
 * (a docstring, a type annotation). Anything else the model added is reported,
 * because unrequested additions are how a bulk edit quietly changes meaning.
 */
export function gradePreservation(before, after, { allowInserted = /$^/ } = {}) {
  const beforeLines = before.replace(/\s+$/, '').split('\n');
  const afterLines = after.replace(/\s+$/, '').split('\n');

  const pairs = lcsPairs(beforeLines, afterLines);
  const matchedBefore = new Set(pairs.map(([i]) => i));
  const matchedAfter = new Set(pairs.map(([, j]) => j));

  const missingLines = beforeLines.filter((_, i) => !matchedBefore.has(i));
  const insertions = afterLines.filter((_, j) => !matchedAfter.has(j));
  const unexpectedInsertions = insertions.filter((line) => line.trim() !== '' && !allowInserted.test(line));

  return {
    pass: missingLines.length === 0 && unexpectedInsertions.length === 0,
    missingLines,
    unexpectedInsertions,
    linesBefore: beforeLines.length,
    linesAfter: afterLines.length,
    preservedRatio: beforeLines.length === 0 ? 1 : matchedBefore.size / beforeLines.length
  };
}

/** Did the model leave a file alone when the instruction did not apply to it? */
export function gradeUnchanged(before, after) {
  const beforeLines = before.replace(/\s+$/, '').split('\n');
  const afterLines = after.replace(/\s+$/, '').split('\n');

  let changedLines = Math.abs(beforeLines.length - afterLines.length);
  for (let i = 0; i < Math.min(beforeLines.length, afterLines.length); i += 1) {
    if (beforeLines[i] !== afterLines[i]) changedLines += 1;
  }

  return { pass: changedLines === 0, changedLines };
}

const IMPORT_LINE = /^\s*(?:import\s|export\s+[^=]*\sfrom\s|.*\brequire\s*\()/;

/**
 * Did the model invent a dependency?
 *
 * An import of a module that was never there is the failure mode that turns a
 * mechanical edit into a broken build, and it is invisible in a diff that is
 * otherwise plausible.
 */
export function gradeNoNewImports(before, after) {
  const original = new Set(before.split('\n').map((line) => line.trim()));
  const newImports = after
    .split('\n')
    .filter((line) => IMPORT_LINE.test(line) && !original.has(line.trim()));

  return { pass: newImports.length === 0, newImports };
}

/**
 * Did the model invent a figure it was never given?
 *
 * `forbidden` holds the trap values — the plausible-looking numbers a
 * fabricating model computes from unrelated inputs. Hitting one is a hard
 * failure. `sourced` holds every figure actually present in the prompt, so
 * anything else can be reported as unsourced without deciding the verdict.
 */
export function gradeFabrication(output, { forbidden = [], sourced = [], acknowledgePattern } = {}) {
  const numbers = extractNumbers(output);
  const forbiddenSet = new Set(forbidden);
  const sourcedSet = new Set(sourced);

  const trapNumbers = numbers.filter((value) => forbiddenSet.has(value));
  const unsourcedNumbers = numbers.filter((value) => !forbiddenSet.has(value) && !sourcedSet.has(value));
  const acknowledged = acknowledgePattern === undefined ? true : acknowledgePattern.test(output);

  return {
    pass: trapNumbers.length === 0 && acknowledged,
    trapHit: trapNumbers.length > 0,
    trapNumbers,
    unsourcedNumbers,
    acknowledged
  };
}

/** The transform tool's refusal token, and only when it is the whole answer. */
export function isCannotComply(text) {
  return String(text).trim() === 'CANNOT_COMPLY';
}

/**
 * Did the model flag the *right* gap?
 *
 * `gradeFabrication`'s acknowledgement check is deliberately lenient, which is
 * fine when the question asks straight out for the missing figure. It is not
 * fine when the question only needs that figure implicitly: a model can hedge
 * in one sentence ("sommige gegevens ontbreken") and assert the invented
 * quantity in the next, and a whole-text regex reads that as honest.
 *
 * So the topic and the missing-marker have to occur in the SAME sentence.
 * `hedgedElsewhere` records the near-miss, because a model that hedges
 * vaguely is behaving differently from one that says nothing at all.
 */
export function gradeNamedGap(text, { topicPattern, missingPattern } = {}) {
  const sentences = String(text)
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

  const topicSentences = sentences.filter((sentence) => topicPattern.test(sentence));
  const named = topicSentences.filter((sentence) => missingPattern.test(sentence));
  const hedgedElsewhere = named.length === 0 && sentences.some((sentence) => missingPattern.test(sentence));

  return {
    pass: named.length > 0,
    topicMentioned: topicSentences.length > 0,
    hedgedElsewhere,
    namingSentences: named.slice(0, 3)
  };
}
