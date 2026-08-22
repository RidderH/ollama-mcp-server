/**
 * Gap #5 — structured output. Can a delegated result be piped into a program?
 *
 * Everything else in this harness measures whether the model is right. This
 * measures whether a *caller* can act on the answer mechanically, which is a
 * different question with three separate failure modes: not JSON at all, JSON
 * of the wrong shape, and the right shape carrying wrong values. Only the
 * first two are catchable by the caller, so they are graded and reported apart.
 *
 * Two variants per task, differing in one field and nothing else:
 *
 *   A  the schema pasted into the prompt          — what the tool can do today
 *   B  the same prompt plus Ollama's `format`     — what adding one field would buy
 *
 * `src/services/ollama.ts` sends no `format`, so B is not reachable through
 * the MCP tools as they ship. It is here because "add four lines to the
 * server" is a decision this measurement can settle.
 *
 * Both run with thinking OFF so the pair differs only in enforcement. The
 * shipped default is thinking ON, so S5/S6 re-run the flat task in that
 * configuration — the interaction turned out to matter and to be silent.
 *
 * Latency caveat: A and B send identical prompt bytes, so B lands on Ollama's
 * prompt cache and its wall time understates a cold call by roughly an order
 * of magnitude. A-vs-B is valid for correctness and invalid for latency.
 */

import { readFileSync } from 'node:fs';

import { parseJsonOutput, validateSchema, compareValues } from '../lib/jsonshape.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const DOC = readFileSync(new URL('../fixtures/structured/debiteuren.txt', import.meta.url), 'utf8').trim();
const TRUTH = JSON.parse(
  readFileSync(new URL('../fixtures/structured/ground-truth.json', import.meta.url), 'utf8')
);

const FACTUUR_STATUSES = ['betaald', 'open', 'vervallen', 'overig'];

const TASKS = [
  {
    id: 'S1-flat',
    question: 'The easiest possible case: three scalar fields, every one of them present in the source. Does it come back as parseable JSON of the right shape?',
    decision:
      'If the flat case is not reliably parseable, no delegated result may be piped into a program ' +
      'without an extractor and a validator in front of it, whatever the task.',
    task:
      'Vat dit overzicht samen: de peildatum (ISO, jjjj-mm-dd), het aantal facturen, en het totaalbedrag ' +
      'van alle facturen samen.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['peildatum', 'aantalFacturen', 'totaalBedrag'],
      properties: {
        peildatum: { type: 'string' },
        aantalFacturen: { type: 'integer' },
        totaalBedrag: { type: 'number' }
      }
    }
  },
  {
    id: 'S2-nested',
    question: 'Nesting: an object holding an array of objects, plus a total that has to be computed from it. Does the structure survive, and does every row?',
    decision:
      'A dropped or merged row inside a valid-looking array is the quiet failure — the JSON parses, the ' +
      'shape validates, and the caller never learns a factuur went missing. If it happens, an extraction ' +
      'over a table must have its row count checked by the caller, not by the model.',
    task:
      'Zet dit overzicht om in JSON: de naam van de leverancier, de peildatum (ISO, jjjj-mm-dd), elke ' +
      "factuur met nummer, klant en bedrag als getal in euro's, en het totaalbedrag van alle facturen samen.",
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['leverancier', 'peildatum', 'facturen', 'totaalBedrag'],
      properties: {
        leverancier: { type: 'string' },
        peildatum: { type: 'string' },
        totaalBedrag: { type: 'number' },
        facturen: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nummer', 'klant', 'bedrag'],
            properties: {
              nummer: { type: 'string' },
              klant: { type: 'string' },
              bedrag: { type: 'number' }
            }
          }
        }
      }
    }
  },
  {
    id: 'S3-enum',
    question: 'A fixed vocabulary with one row the source describes in a word that is not in it. Does it stay in vocabulary, or invent a category?',
    decision:
      'This is gap #6 in miniature. If "deels betaald" comes back as its own category, a delegated ' +
      'classification cannot be consumed by a switch statement and every caller needs an allowlist check. ' +
      'If it comes back as "overig", classification against a fixed list is safe to delegate.',
    task:
      'Bepaal voor elke factuur de status. Gebruik uitsluitend een van deze vier waarden: ' +
      `${FACTUUR_STATUSES.join(', ')}. Past een factuur niet in de eerste drie, gebruik dan "overig".`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['facturen'],
      properties: {
        facturen: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nummer', 'status'],
            properties: {
              nummer: { type: 'string' },
              status: { type: 'string', enum: FACTUUR_STATUSES }
            }
          }
        }
      }
    }
  },
  {
    id: 'S4-nullable',
    question:
      'Two kinds of absent field: a betaaldatum the source marks with a dash, and a kredietlimiet the ' +
      'source has no column for at all. Does it emit null, invent a value, or abandon the JSON to explain itself?',
    decision:
      'This is gap #2 asked in JSON. An invented date in a nullable field is unfalsifiable downstream — ' +
      'the shape validates and the value is wrong. If it fabricates here, no schema with an optional field ' +
      'may be delegated; if it answers in prose instead, a caller must handle a non-JSON answer as a ' +
      'legitimate outcome rather than a transport error.',
    task:
      'Geef voor elke factuur het nummer, de betaaldatum (ISO, jjjj-mm-dd) en de kredietlimiet van de klant. ' +
      'Staat een waarde niet in het overzicht, gebruik dan null.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['facturen'],
      properties: {
        facturen: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nummer', 'betaaldatum', 'kredietlimiet'],
            properties: {
              nummer: { type: 'string' },
              betaaldatum: { type: ['string', 'null'] },
              kredietlimiet: { type: ['number', 'null'] }
            }
          }
        }
      }
    }
  }
];

/**
 * The prompt both variants send.
 *
 * The schema is pasted in even when `format` will enforce it, so the two
 * variants differ in enforcement alone. "Geen uitleg, geen code fences" is
 * what a careful caller writes; whether it is obeyed is part of the finding.
 */
function buildPrompt(task) {
  return [
    DOC,
    '',
    task.task,
    '',
    'Antwoord uitsluitend met JSON dat exact aan dit JSON Schema voldoet. Geen uitleg, geen inleidende zin,',
    'geen code fences, geen extra velden.',
    '',
    JSON.stringify(task.schema, null, 2)
  ].join('\n');
}

/** Grade the three failure modes apart, then require all three to pass. */
export function gradeStructured(text, task) {
  const parsed = parseJsonOutput(text);
  const shape = parsed.value === undefined ? { pass: false, errors: ['no JSON to validate'] } : validateSchema(parsed.value, task.schema);
  const content =
    parsed.value === undefined
      ? { pass: false, mismatches: [{ path: 'root', expected: TRUTH[task.id], actual: undefined }] }
      : compareValues(parsed.value, TRUTH[task.id]);

  return {
    pass: parsed.parsesScanned && shape.pass && content.pass,
    detail: {
      // The three verdicts a caller defends against differently.
      isJson: parsed.parsesScanned,
      schemaValid: shape.pass,
      contentCorrect: content.pass,
      // How much work the caller had to do to get at it. `raw` is the only
      // level at which a plain JSON.parse(result.text) succeeds; the delegate
      // tool strips think blocks but not fences.
      parseLevel: parsed.level,
      fenced: parsed.fenced,
      schemaErrors: shape.errors?.slice(0, 8) ?? [],
      mismatches: content.mismatches.slice(0, 8),
      firstLine: String(text).trim().split('\n')[0]?.slice(0, 160) ?? ''
    }
  };
}

const VARIANTS = [
  { suffix: 'A-prompt-only', format: false, disableThinking: true },
  { suffix: 'B-native-format', format: true, disableThinking: true }
];

const SCHEMA_PROBES = TASKS.flatMap((task) =>
  VARIANTS.map((variant) => ({
    id: `${task.id}--${variant.suffix}`,
    gap: 'structured_output',
    output: 'text',
    question: task.question,
    decision: task.decision,
    variant: variant.suffix,
    build: () => ({
      system: DELEGATE_SYSTEM_PROMPT,
      prompt: buildPrompt(task),
      options: {
        disableThinking: variant.disableThinking,
        ...(variant.format ? { format: task.schema } : {})
      }
    }),
    grade: (text) => gradeStructured(text, task)
  }))
);

/**
 * S5/S6 — the same flat task in the configuration the tools actually ship.
 *
 * `disable_thinking` defaults to false in `src/schemas/common.ts`, so a real
 * delegation runs with thinking ON. A first look suggested `format` is not
 * applied in that configuration: HTTP 200, a `thinking` field on the message,
 * and markdown prose in `content` where a schema-constrained object was asked
 * for. If that reproduces, then adding `format` to the server without also
 * forcing thinking off buys nothing, and buys it silently.
 */
const THINKING_TASK = TASKS[0];
const THINKING_PROBES = [
  {
    suffix: 'S6-prompt-only-thinking-on',
    format: false,
    question: 'Prompt-only JSON in the shipped default configuration — does the thinking phase cost the JSON?',
    decision:
      'The control for S5. If prompt-only holds up with thinking on and the enforced variant does not, ' +
      'the fault is in `format`, not in thinking.'
  },
  {
    suffix: 'S5-native-format-thinking-on',
    format: true,
    question: 'Is Ollama\'s `format` honoured when the model thinks — the configuration the server would send by default?',
    decision:
      'Decides whether adding `format` to the server also requires forcing disable_thinking. A 200 with ' +
      'prose in it is the worst outcome: the enforcement a caller believes in is not there, and nothing ' +
      'in the response says so.'
  }
].map((variant) => ({
  id: variant.suffix,
  gap: 'structured_output',
  output: 'text',
  question: variant.question,
  decision: variant.decision,
  variant: variant.suffix,
  build: () => ({
    system: DELEGATE_SYSTEM_PROMPT,
    prompt: buildPrompt(THINKING_TASK),
    options: {
      disableThinking: false,
      ...(variant.format ? { format: THINKING_TASK.schema } : {})
    }
  }),
  grade: (text) => gradeStructured(text, THINKING_TASK)
}));

/**
 * S7/S8 — is `format` a constraint, or a suggestion?
 *
 * S1-S6 all paste the schema into the prompt as well, so a pass there cannot
 * tell enforcement apart from instruction-following. Here the prompt asks the
 * question in plain Dutch and says nothing about JSON, about field names, or
 * about a schema: `format` is the only thing that could produce the shape.
 *
 * The distinction is not academic. Ollama constrains sampling with a grammar
 * where the runner supports one; the model under test runs on MLX, and a first
 * look at exactly this configuration returned markdown prose under HTTP 200
 * with `format` set — which is what a suggestion looks like.
 */
const BARE_TASK = TASKS[0];
const BARE_PROBES = [false, true].map((thinking) => ({
  id: thinking ? 'S8-format-alone-thinking-on' : 'S7-format-alone-thinking-off',
  gap: 'structured_output',
  output: 'text',
  question:
    'With `format` set and the prompt saying nothing about JSON, does the schema still govern the answer?',
  decision:
    'Decides whether `format` could ever replace the "antwoord uitsluitend met JSON" instruction, or ' +
    'only reinforce it. If the schema alone does not produce JSON, then adding `format` to the server ' +
    'is a belt on top of a prompt that must stay — and a caller who trusts it instead of the prompt gets ' +
    'prose under a 200.',
  variant: thinking ? 'thinking-on' : 'thinking-off',
  build: () => ({
    system: DELEGATE_SYSTEM_PROMPT,
    prompt: [DOC, '', BARE_TASK.task].join('\n'),
    options: { disableThinking: !thinking, format: BARE_TASK.schema }
  }),
  grade: (text) => gradeStructured(text, BARE_TASK)
}));

export const STRUCTURED_PROBES = [...SCHEMA_PROBES, ...THINKING_PROBES, ...BARE_PROBES];

/** Exposed so the composite pass rule can be shown failing on a known-bad answer. */
export const STRUCTURED_TASKS = TASKS;
