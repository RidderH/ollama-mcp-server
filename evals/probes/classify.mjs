/**
 * Gap #6 — classification against a fixed list.
 *
 * The rule file has listed "classifying against a fixed list" as a delegate
 * case since before any of it was measured. The open question is not accuracy
 * on the easy rows; it is what happens to a row that belongs in **none** of the
 * offered categories, because that answer comes back looking exactly like a
 * right one. Four of the ten expense lines in the fixture have no home in the
 * four categories on offer — a notary bill, solar panels, a training course,
 * a health insurance premium — and a bookkeeper would post each somewhere else.
 *
 * Two levers, crossed, so each is measured on its own:
 *
 *   escape   is "overig" among the choices, or is the list closed?
 *   doubt    is there a `zekerheid` field to say "this one is a stretch"?
 *
 * The doubt lever is gap #5's finding carried over: a nullable field turned
 * out to be a place to put "I don't have this", and this asks whether a
 * confidence field is a place to put "this doesn't fit". A field that is
 * flagged on nothing discloses nothing; one flagged on everything is noise.
 *
 * Every repeat rotates the rows (finding 25), so three repeats are three
 * observations and not one prompt-cached answer three times over. Grading is
 * by row id, never by position.
 */

import { readFileSync } from 'node:fs';

import { parseJsonOutput, validateSchema } from '../lib/jsonshape.mjs';
import { gradeClassification, gradeDoubtSignal } from '../lib/classify.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/classify/kosten.json', import.meta.url), 'utf8')
);

const ITEMS = FIXTURE.items;
const TRUTH = Object.fromEntries(ITEMS.map((item) => [item.id, item.truth]));
const HARD_IDS = ITEMS.filter((item) => item.hard).map((item) => item.id);
const EASY_IDS = ITEMS.filter((item) => !item.hard).map((item) => item.id);

/** Ground truth restricted to the rows a closed list *can* get right. */
const EASY_TRUTH = Object.fromEntries(EASY_IDS.map((id) => [id, TRUTH[id]]));

/** A different row order per repeat, deterministic so a run is reproducible. */
function rotate(items, repeat) {
  const offset = ((repeat - 1) * 3) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function buildSchema({ escape, doubt }) {
  const categories = escape ? [...FIXTURE.categories, FIXTURE.escape] : [...FIXTURE.categories];
  const properties = {
    id: { type: 'string' },
    categorie: { type: 'string', enum: categories }
  };
  if (doubt) properties.zekerheid = { type: 'string', enum: ['hoog', 'laag'] };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['regels'],
    properties: {
      regels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: doubt ? ['id', 'categorie', 'zekerheid'] : ['id', 'categorie'],
          properties
        }
      }
    }
  };
}

function buildPrompt({ escape, doubt }, repeat) {
  const rows = rotate(ITEMS, repeat).map((item) => `${item.id}  ${item.omschrijving}`);
  const instructions = [
    `Deel elke regel in bij één grootboekcategorie. Gebruik uitsluitend deze categorieën: ${FIXTURE.categories.join(', ')}.`
  ];
  if (escape) {
    instructions.push(`Past een regel bij geen van deze categorieën, gebruik dan "${FIXTURE.escape}".`);
  }
  if (doubt) {
    instructions.push(
      'Geef per regel ook aan hoe zeker je bent: "hoog" als de regel duidelijk in de gekozen categorie ' +
        'thuishoort, "laag" als het een gedwongen keuze is.'
    );
  }

  return [
    'Hieronder staan tien kostenregels uit de boekhouding van een klein bedrijf.',
    '',
    ...rows,
    '',
    ...instructions,
    '',
    'Antwoord uitsluitend met JSON dat exact aan dit JSON Schema voldoet. Geen uitleg, geen inleidende zin,',
    'geen code fences, geen extra velden.',
    '',
    JSON.stringify(buildSchema({ escape, doubt }), null, 2)
  ].join('\n');
}

/**
 * Grade one classification answer.
 *
 * The pass rule differs by variant, and has to. With "overig" on offer there
 * is a fully correct answer and the bar is that answer. With the list closed
 * there is none: four rows cannot be right, so the bar is **the six that can
 * be, plus a signal on the four that cannot**. Silently forcing all ten into a
 * category is the failure being looked for, and it is a failure that returns
 * ten perfectly valid labels.
 */
export function gradeClassify(text, variant) {
  const schema = buildSchema(variant);
  const parsed = parseJsonOutput(text);
  const rows = parsed.value?.regels;
  const shape = parsed.value === undefined ? { pass: false, errors: ['no JSON to validate'] } : validateSchema(parsed.value, schema);

  const allowed = variant.escape ? [...FIXTURE.categories, FIXTURE.escape] : [...FIXTURE.categories];
  const classification = gradeClassification(rows, {
    allowed,
    truth: variant.escape ? TRUTH : EASY_TRUTH,
    escape: FIXTURE.escape
  });
  const doubt = variant.doubt
    ? gradeDoubtSignal(rows, { hardIds: HARD_IDS, field: 'zekerheid', lowValue: 'laag' })
    : undefined;

  // Anything the model wrote outside the JSON. The first run of this probe
  // found the signal living here and nowhere else -- "INSUFFICIENT: de regels
  // R6, R7, R8 en R9 kunnen niet worden toegewezen" ahead of a JSON body that
  // forced all four anyway. A grader that only inspects the rows scores that
  // as a silent failure, which is the opposite of what happened.
  const preamble = String(text).trim().split(/[[{]/)[0] ?? '';
  // The shipped tool's own detection, copied from `src/tools/delegate.ts`:
  // anchored at the start of the think-stripped text, so a caller sees it only
  // when the sentence leads the answer.
  const insufficientFlagWouldFire = /^INSUFFICIENT:/i.test(String(text).trim());

  // Every channel through which the model could have said "this row does not
  // fit": prose naming the row, reaching for a category it was not offered, or
  // flagging low confidence. Counted per row so a partial signal reads as partial.
  const hardSignalled = new Set();
  for (const id of HARD_IDS) {
    if (new RegExp(`\\b${id}\\b`).test(preamble)) hardSignalled.add(id);
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!HARD_IDS.includes(row?.id)) continue;
    const brokeVocabulary = !allowed.includes(row?.categorie);
    const flaggedDoubt = variant.doubt && row?.zekerheid === 'laag';
    if (brokeVocabulary || flaggedDoubt) hardSignalled.add(row.id);
  }

  const pass = variant.escape
    ? parsed.parsesScanned && classification.pass
    : parsed.parsesScanned &&
      classification.correct === EASY_IDS.length &&
      hardSignalled.size === HARD_IDS.length;

  return {
    pass,
    detail: {
      isJson: parsed.parsesScanned,
      schemaValid: shape.pass,
      parseLevel: parsed.level,
      // Of the rows that have a right answer, how many got it.
      correct: classification.correct,
      total: classification.total,
      outOfVocabulary: classification.outOfVocabulary,
      missingIds: classification.missingIds,
      extraIds: classification.extraIds,
      duplicateIds: classification.duplicateIds,
      wrong: classification.wrong,
      escapeUsed: classification.escapeUsed,
      // The heart of the probe: of the four rows with no right answer, how
      // many did the model say anything about?
      hardSignalled: [...hardSignalled],
      hardTotal: HARD_IDS.length,
      insufficientFlagWouldFire,
      preamble: preamble.trim().slice(0, 300),
      ...(doubt ? { doubt } : {}),
      schemaErrors: shape.errors?.slice(0, 6) ?? []
    }
  };
}

const VARIANTS = [
  {
    id: 'C1-closed-list',
    escape: false,
    doubt: false,
    question:
      'Four of the ten rows belong in none of the four categories offered. Does the model say so, or ' +
      'does it quietly post them somewhere?',
    decision:
      'This is the configuration the rule file has been recommending by omission — "classify against a ' +
      'fixed list", with no word about what the list must contain. If the model forces the four silently, ' +
      'the recommendation is unsafe as written and the rule has to name the escape category.'
  },
  {
    id: 'C2-escape-offered',
    escape: true,
    doubt: false,
    question: 'With "overig" among the choices, does it reach for it on exactly the rows that need it?',
    decision:
      'Decides whether an escape category is enough on its own. Over-use is as bad as under-use: a model ' +
      'that posts half the easy rows to "overig" has made the output useless in the other direction.'
  },
  {
    id: 'C3-closed-with-doubt',
    escape: false,
    doubt: true,
    question:
      'The list is still closed, but now there is a `zekerheid` field. Does the doubt land on the four ' +
      'rows that were forced?',
    decision:
      'Gap #5 found that a nullable field gives absence somewhere to go. This asks whether a confidence ' +
      'field does the same for a bad fit. If it does, a closed list stays delegable as long as the ' +
      'caller reads the flag; if it does not, only the escape category works.'
  },
  {
    id: 'C4-escape-and-doubt',
    escape: true,
    doubt: true,
    question: 'Both levers at once — does the confidence field still discriminate when nothing needs forcing?',
    decision:
      'Guards against the cheerful failure mode: a `zekerheid` field that reads "hoog" on all ten rows ' +
      'teaches a caller to trust it, and would then be trusted on the run where it matters.'
  }
];

export const CLASSIFY_PROBES = VARIANTS.map((variant) => ({
  id: variant.id,
  gap: 'classification',
  output: 'text',
  question: variant.question,
  decision: variant.decision,
  variant: variant.id,
  build: (repeat = 1) => ({
    system: DELEGATE_SYSTEM_PROMPT,
    prompt: buildPrompt(variant, repeat),
    options: { disableThinking: true }
  }),
  grade: (text) => gradeClassify(text, variant)
}));

/** Exposed so the two pass rules can be shown failing on a known-bad answer. */
export const CLASSIFY_VARIANTS = VARIANTS;
