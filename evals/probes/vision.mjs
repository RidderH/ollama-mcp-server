/**
 * Gap #8 — vision.
 *
 * The rule file's vision paragraph rests on n=1: one clean invoice crop, ten
 * lines read exactly. That is a fine result and a thin basis for routing
 * scanned documents to a local model, because the cases that matter are the
 * ones that are not a clean crop.
 *
 * The fixtures vary two axes over the same invoice — resolution and rotation —
 * built by `make-fixtures.mjs` from a hand-written PDF, so resolution is an
 * exact dial rather than an image scaled down after the fact.
 *
 * Two things are graded apart, and they fail differently:
 *
 *   read   the cells, per column, against what is printed
 *   infer  the one cell arithmetic cannot predict — D-012 is printed at 85,00
 *          against 1 x 95,00, so a model that multiplies rather than looks is
 *          caught there and in the total, and nowhere else
 *
 * Not measured: **handwriting**. There is no faithful fixture for it here —
 * a cursive font is evenly spaced, has no baseline drift and no pen pressure,
 * so passing it would say nothing about a real hand. It stays open rather than
 * answered by a proxy that flatters the result.
 */

import { readFileSync } from 'node:fs';

import { parseJsonOutput, validateSchema, compareValues } from '../lib/jsonshape.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const TRUTH = JSON.parse(
  readFileSync(new URL('../fixtures/vision/ground-truth.json', import.meta.url), 'utf8')
);

const CODES = Object.keys(TRUTH.regels);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['regels', 'totaalExclBtw'],
  properties: {
    totaalExclBtw: { type: 'number' },
    regels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'aantal', 'stukprijs', 'btwPercentage', 'regeltotaal'],
        properties: {
          code: { type: 'string' },
          aantal: { type: 'integer' },
          stukprijs: { type: 'number' },
          btwPercentage: { type: 'number' },
          regeltotaal: { type: 'number' }
        }
      }
    }
  }
};

const ASK = [
  'Op de afbeelding staat een factuur met een tabel.',
  '',
  'Neem elke regel uit de tabel over: de code, het aantal, de stukprijs, het btw-percentage en het',
  'regeltotaal. Neem de bedragen over zoals ze op de factuur staan; reken niets zelf uit. Geef ook',
  'het totaalbedrag exclusief btw zoals dat onderaan de tabel staat.',
  '',
  'Antwoord uitsluitend met JSON dat exact aan dit JSON Schema voldoet. Geen uitleg, geen inleidende zin,',
  'geen code fences, geen extra velden.',
  '',
  JSON.stringify(SCHEMA, null, 2)
].join('\n');

/** The cells whose value cannot be reached by arithmetic over other cells. */
const READ_ONLY_CELLS = ['regels.D-012.regeltotaal', 'totaalExclBtw'];

export function gradeVision(text) {
  const parsed = parseJsonOutput(text);
  const shape = parsed.value === undefined ? { pass: false, errors: ['no JSON to validate'] } : validateSchema(parsed.value, SCHEMA);

  // Key the rows by code so a row read out of order still grades, and a
  // missing or invented code is visible as such rather than as six wrong cells.
  const rows = Array.isArray(parsed.value?.regels) ? parsed.value.regels : [];
  const byCode = {};
  for (const row of rows) {
    if (row?.code !== undefined && byCode[row.code] === undefined) byCode[row.code] = row;
  }

  const actual = { totaalExclBtw: parsed.value?.totaalExclBtw, regels: byCode };
  const expected = { totaalExclBtw: TRUTH.totaalExclBtw, regels: TRUTH.regels };
  const content = compareValues(actual, expected, { tolerance: 0.005 });

  const missingCodes = CODES.filter((code) => byCode[code] === undefined);
  const extraCodes = Object.keys(byCode).filter((code) => !CODES.includes(code));

  // A mismatch on one of these means the figure was inferred rather than read:
  // both are unreachable from the other cells by any arithmetic.
  const inferredNotRead = content.mismatches.filter((m) => READ_ONLY_CELLS.includes(m.path));
  const misreadCells = content.mismatches.filter((m) => !READ_ONLY_CELLS.includes(m.path));

  return {
    // An invented row has to sink the verdict: the schema permits any array
    // length and `compareValues` walks only the codes ground truth names, so
    // nothing else here would notice a seventh line that is not on the page.
    //
    // `missingCodes` is deliberately NOT a term. A code that is absent is
    // already a content mismatch on every one of its cells, so the term could
    // never be the deciding one — neutering it left the suite green, which is
    // the signature of an assertion no fixture can drive. It stays as a
    // diagnostic, because "a row went missing" reads very differently from
    // "four cells were misread", and it is the same underlying event.
    pass: parsed.parsesScanned && shape.pass && content.pass && extraCodes.length === 0,
    detail: {
      isJson: parsed.parsesScanned,
      schemaValid: shape.pass,
      // Recorded because gap #5 measured 0/30 fenced answers on text tasks and
      // the vision runs fence about a third of the time: the habit is a
      // property of the task, not of the instruction, and both tasks carry the
      // same "geen code fences".
      parseLevel: parsed.level,
      fenced: parsed.fenced,
      allCellsCorrect: content.pass,
      cellsWrong: content.mismatches.length,
      // 30 cells: six rows of four figures, plus the code, plus the total.
      misreadCells: misreadCells.slice(0, 10),
      inferredNotRead,
      missingCodes,
      extraCodes,
      schemaErrors: shape.errors?.slice(0, 6) ?? [],
      firstLine: String(text).trim().split('\n')[0]?.slice(0, 140) ?? ''
    }
  };
}

const FIXTURES = [
  {
    id: 'V1-clean-150dpi',
    file: 'invoice-150dpi.png',
    question: 'The baseline: a clean 150 dpi render, 1240x646. Does every cell come back as printed?',
    decision:
      'Establishes at n=3 what the rule file currently claims at n=1. If this is not solid, nothing ' +
      'below it can be, and the vision paragraph has to be rewritten rather than extended.'
  },
  {
    id: 'V2-low-60dpi',
    file: 'invoice-60dpi.png',
    question: 'The same page at 60 dpi, 496x259 — a small scan or a screenshot. Where does reading give out?',
    decision:
      'Sets the resolution floor for delegating a scanned document. If 60 dpi still reads exactly, almost ' +
      'any real scan is safe; if it degrades silently, every scan needs its figures checked.'
  },
  {
    id: 'V3-rotated-150dpi',
    file: 'invoice-rotated.png',
    question: 'Three degrees off true at full resolution — a page photographed on a desk. Do the columns stay associated?',
    decision:
      'Rotation is the commonest defect in a document someone sends you, and the one that breaks column ' +
      'association: the failure is a value read from the neighbouring column, which looks entirely plausible.'
  },
  {
    id: 'V4-rotated-60dpi',
    file: 'invoice-rotated-60dpi.png',
    question: 'Both defects at once — the realistic worst case of a phone photo forwarded by a client.',
    decision:
      'Decides whether a bad scan may be delegated at all, or must be re-scanned before it is worth asking. ' +
      'Failing here while V2 and V3 pass would mean the two defects compound rather than add.'
  }
];

export const VISION_PROBES = FIXTURES.map((fixture) => ({
  id: fixture.id,
  gap: 'vision',
  output: 'text',
  question: fixture.question,
  decision: fixture.decision,
  variant: fixture.id,
  build: () => ({
    system: DELEGATE_SYSTEM_PROMPT,
    prompt: ASK,
    options: {
      disableThinking: true,
      images: [readFileSync(new URL(`../fixtures/vision/${fixture.file}`, import.meta.url)).toString('base64')]
    }
  }),
  grade: (text) => gradeVision(text)
}));

/** Exposed so the read-versus-infer rule can be shown failing. */
export const VISION_SCHEMA = SCHEMA;
