/**
 * Gap #9 — multi-fact synthesis over a long prompt.
 *
 * The rule file's read ceiling ("treat ~40k as the read ceiling") rests on the
 * H probes, and those plant **one** fact and ask for **one** fact. The rule
 * says so itself: "measured on single-fact retrieval only; multi-fact
 * synthesis across a long prompt is untested and may well degrade earlier."
 * This is that test.
 *
 * Five branches carry a quarterly figure, spread from the first branch to the
 * last, and the question asks for all five plus their total. Every other
 * branch carries a figure of its own, so a number is not a signal and the
 * model has to match on the city. The ladder mirrors the single-fact one --
 * 05k / 15k / 25k / 35k prompt tokens, thinking on, num_ctx at the shipped
 * 32768 -- so the two are read side by side and the difference between them is
 * the number of facts and nothing else.
 *
 * The answer is JSON with the schema in the prompt (finding 21), which is what
 * makes the two failure modes separable: `recall` counts figures retrieved,
 * `arithmeticConsistent` says whether the total is the sum of what the model
 * itself reported. Five right figures and a wrong total is an arithmetic
 * failure; a wrong total that matches four right figures and one misread is a
 * retrieval failure. They send the work to different places, so they are
 * graded and reported apart.
 *
 * Every repeat rotates which needle sits in which slot: the bytes differ, so
 * three repeats are three observations rather than one prompt-cached answer
 * three times over (finding 25), and each figure is sampled at more than one
 * depth in the window.
 */

import { buildMultiHaystack, MULTI_NEEDLES } from '../lib/haystack.mjs';
import { gradeMultiFact, MULTIFACT_SCHEMA } from '../lib/multifact.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

/**
 * Branch counts for the four prompt sizes.
 *
 * Calibrated at 541 chars per branch and the 3,77 chars/token the recorded H
 * runs give for this vocabulary (206 branches -> 35.078 prompt tokens). The
 * runner records `promptTokens` per call, so the labels are checked against
 * what Ollama actually read rather than trusted.
 */
const SIZES = [
  { label: '05k', branches: 35 },
  { label: '15k', branches: 105 },
  { label: '25k', branches: 175 },
  { label: '35k', branches: 245 }
];

/** A different order of the asked-for cities per repeat. The corpus already
    moves; this moves the question too, and grading is by city either way. */
function rotate(items, repeat) {
  const offset = (repeat - 1) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function multiFactProbe({ label, branches }) {
  // Where the needles sat in the corpus this call was built from. The runner
  // is serial and calls build() immediately before grade(), so this is the
  // placement of the answer being graded -- and it lets a miss be read against
  // the depth it sat at, which is the whole reason the slots rotate.
  let depths = {};

  return {
    id: `M-${label}-five-facts`,
    gap: 'multi_fact_synthesis',
    output: 'text',
    question: `At roughly ${label} prompt tokens, are five facts spread through the prompt still retrievable, and can they be combined?`,
    decision:
      'Fixes whether the ~40k read ceiling holds for a question with more than one answer in it, or ' +
      'whether a long delegated read must be restricted to a single lookup. Separates the two reasons ' +
      'it could fail: figures not found, or found figures added up wrong.',
    build: (repeat = 1) => {
      const { corpus, placements } = buildMultiHaystack(branches, repeat);
      depths = Object.fromEntries(placements.map((p) => [p.plaats, p.fraction]));
      const cities = rotate(MULTI_NEEDLES.map((needle) => needle.plaats), repeat);
      return {
        system: DELEGATE_SYSTEM_PROMPT,
        prompt: [
          'Hieronder staat een overzicht van vestigingen.',
          '',
          corpus,
          '',
          `Vraag: geef voor de vestigingen ${cities.slice(0, -1).join(', ')} en ${cities.at(-1)} het ` +
            'aantal zendingen dat in het afgelopen kwartaal is verwerkt, en het totaal van deze vijf ' +
            'vestigingen samen.',
          '',
          'Antwoord uitsluitend met JSON dat exact aan dit JSON Schema voldoet. Geen uitleg, geen',
          'inleidende zin, geen code fences, geen extra velden.',
          '',
          JSON.stringify(MULTIFACT_SCHEMA, null, 2)
        ].join('\n'),
        // Recorded so a failure can be read against where the figure sat.
        meta: { placements }
      };
    },
    grade: (text) => {
      const graded = gradeMultiFact(text, MULTI_NEEDLES);
      return { pass: graded.pass, detail: { branches, depths, ...graded.detail } };
    }
  };
}

export const MULTIFACT_PROBES = SIZES.map((size) => multiFactProbe(size));
