/**
 * Gap #4 — the prompt budget.
 *
 * The rule file says "budget ~25.000 prompt tokens per call". That number was
 * extrapolated from a single timeout: it marks where a call *died*, not where
 * the model stops finding things. Those are different limits and only one of
 * them is about the model.
 *
 * These probes plant one dossier code in a corpus of branch descriptions that
 * each carry a code of their own, and ask for that one branch. Sizes step
 * 5k / 15k / 25k / 35k prompt tokens at the shipped defaults — num_ctx 32768,
 * thinking on — so the last step deliberately overruns the context window the
 * tool actually ships with, which is the condition a real 35k delegation meets.
 *
 * Reported alongside recall: wall time against the 300 s MCP ceiling, and the
 * prompt tokens Ollama says it read, which is where truncation becomes visible.
 */

import { gradeFabrication } from '../lib/graders.mjs';
import { buildHaystack, NEEDLE_CITY, NEEDLE_CODE } from '../lib/haystack.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const CODE_PATTERN = /\b[A-Z][A-Z]-\d{4}-[A-Z]\b/g;

/** Branch counts calibrated at ~170 prompt tokens each, measured 2026-08-20. */
const SIZES = [
  { label: '05k', branches: 29 },
  { label: '15k', branches: 88 },
  { label: '25k', branches: 147 },
  { label: '35k', branches: 206 }
];

function haystackProbe({ label, branches, position = 0.5 }) {
  return {
    id: `H-${label}-middle`,
    gap: 'prompt_budget',
    output: 'text',
    question: `At roughly ${label} prompt tokens, is one fact in the middle still retrievable?`,
    decision:
      'Fixes the real ceiling on a delegated lookup: the size where recall starts to slip, and ' +
      'separately the size where the call stops fitting inside the 300 s the MCP layer allows.',
    build: () => {
      const corpus = buildHaystack(branches, position);
      return {
        system: DELEGATE_SYSTEM_PROMPT,
        prompt: [
          'Hieronder staat een overzicht van vestigingen.',
          '',
          corpus,
          '',
          `Vraag: wat is het interne dossiernummer van vestiging ${NEEDLE_CITY}?`,
          'Antwoord met alleen het dossiernummer, zonder verdere tekst.'
        ].join('\n')
      };
    },
    grade: (text) => {
      const mentioned = [...new Set(text.match(CODE_PATTERN) ?? [])];
      const found = mentioned.includes(NEEDLE_CODE);
      // A wrong code returned confidently is worse than no answer: it is the
      // retrieval equivalent of the judgement failure in E4.
      const wrongCodes = mentioned.filter((code) => code !== NEEDLE_CODE);
      const gaveUp = gradeFabrication(text, {
        acknowledgePattern: /INSUFFICIENT|ontbrek|ontbreek|niet gevonden|niet vermeld|geen vestiging|onbekend/i
      }).acknowledged;

      return {
        pass: found && wrongCodes.length === 0,
        detail: {
          branches,
          foundNeedle: found,
          wrongCodes,
          saidNotFound: gaveUp,
          answer: text.trim().slice(0, 160)
        }
      };
    }
  };
}

export const HAYSTACK_PROBES = SIZES.map((size) => haystackProbe(size));
