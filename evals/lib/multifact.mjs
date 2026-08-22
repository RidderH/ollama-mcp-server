/**
 * Grader for the multi-fact probes — gap #9.
 *
 * The single-needle probes ask one question: was the fact found. This one has
 * two answers to keep apart, because they route the work differently:
 *
 *   recall      were all five figures retrieved from the corpus
 *   arithmetic  was the total actually the sum of them
 *
 * A grader collapsing those into "wrong" would leave the finding unwritable.
 * `arithmeticConsistent` is the discriminator: it compares the reported total
 * against the sum of *what the model itself reported*, so a wrong total on
 * five right figures is arithmetic, while a wrong total that matches four
 * right figures and one misread is retrieval. Only the first is a reason to
 * stop delegating sums; only the second is a reason to shorten the prompt.
 */

import { parseJsonOutput, validateSchema } from './jsonshape.mjs';

/** The schema the probe pastes into the prompt, and the one graded against.
    Finding 21: a schema in the prompt is what makes the answer machine-readable. */
export const MULTIFACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vestigingen', 'totaal'],
  properties: {
    vestigingen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['plaats', 'zendingen'],
        properties: {
          plaats: { type: 'string' },
          zendingen: { type: 'integer' }
        }
      }
    },
    totaal: { type: 'integer' }
  }
};

const norm = (plaats) => String(plaats).trim().toLowerCase();

/**
 * Grade one answer against the needles it was asked about.
 *
 * Rows are keyed by city, never by position: the corpus moves the needles
 * between repeats, and a model listing them in its own order is not making a
 * mistake.
 */
export function gradeMultiFact(text, needles) {
  const parsed = parseJsonOutput(text);
  const value = parsed.value;
  const shape = value === undefined ? { pass: false, errors: ['no JSON to validate'] } : validateSchema(value, MULTIFACT_SCHEMA);

  const rows = Array.isArray(value?.vestigingen) ? value.vestigingen : [];
  const byPlaats = new Map();
  for (const row of rows) {
    if (row && typeof row === 'object' && !byPlaats.has(norm(row.plaats))) byPlaats.set(norm(row.plaats), row);
  }

  const missing = [];
  const misread = [];
  let recall = 0;
  for (const needle of needles) {
    const row = byPlaats.get(norm(needle.plaats));
    if (row === undefined) {
      missing.push(needle.plaats);
      continue;
    }
    if (row.zendingen === needle.zendingen) recall += 1;
    else misread.push({ plaats: needle.plaats, expected: needle.zendingen, reported: row.zendingen });
  }

  const asked = new Set(needles.map((needle) => norm(needle.plaats)));
  const extra = rows
    .map((row) => row?.plaats)
    .filter((plaats) => plaats !== undefined && !asked.has(norm(plaats)));

  const totalTrue = needles.reduce((sum, needle) => sum + needle.zendingen, 0);
  const totalOfReported = rows.reduce(
    (sum, row) => (typeof row?.zendingen === 'number' ? sum + row.zendingen : sum),
    0
  );
  const totaalReported = typeof value?.totaal === 'number' ? value.totaal : undefined;

  return {
    pass:
      parsed.parsesScanned &&
      shape.pass &&
      recall === needles.length &&
      missing.length === 0 &&
      extra.length === 0 &&
      totaalReported === totalTrue,
    detail: {
      isJson: parsed.parsesScanned,
      schemaValid: shape.pass,
      parseLevel: parsed.level,
      fenced: parsed.fenced,
      recall,
      of: needles.length,
      missing,
      misread,
      extra,
      totaalReported,
      totalTrue,
      totalOfReported,
      totalExact: totaalReported === totalTrue,
      // True when the model added up its own figures correctly, whatever it
      // read them as. This is what separates a retrieval failure from an
      // arithmetic one, and it is the only reason the two can be reported apart.
      arithmeticConsistent: totaalReported !== undefined && totaalReported === totalOfReported,
      schemaErrors: shape.errors?.slice(0, 6) ?? [],
      firstLine: String(text).trim().split('\n')[0]?.slice(0, 160) ?? ''
    }
  };
}
