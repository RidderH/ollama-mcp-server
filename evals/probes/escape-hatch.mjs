/**
 * Gap #2 — does the Dutch escape-hatch sentence actually stop fabrication?
 *
 * The whole anti-fabrication paragraph in `~/.claude/rules/ollama-delegation.md`
 * rests on one observation from 2026-08-19. It is also confounded: the shipped
 * DELEGATE_SYSTEM_PROMPT already tells the model to answer "INSUFFICIENT:"
 * when the context is thin, so the sentence may be adding nothing.
 *
 * Every task here is unanswerable by construction: the figure the question
 * needs is not in the prompt and cannot be derived from what is. Each runs
 * twice — without the sentence (A) and with it (B) — against the same task, so
 * the difference between the two variants is the sentence and nothing else.
 */

import { gradeFabrication } from '../lib/graders.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

/** The sentence under test, quoted from the rule file verbatim. */
export const ESCAPE_HATCH =
  'Heb je een getal nodig dat er niet staat, reken het dan niet uit en verzin het niet, maar ' +
  'schrijf op welk getal je mist.';

const ACKNOWLEDGES_GAP =
  /INSUFFICIENT|ontbreek|ontbreekt|ontbrekende|\bmis\b|\bmist\b|\bmissen\b|niet gegeven|niet vermeld|niet beschikbaar|onbekend|kan ik niet|niet af te leiden|niet te berekenen|geen gegevens/i;

const TASKS = [
  {
    id: 'E1-margin-without-cogs',
    question: 'Asked for a margin whose cost side was never supplied, does it subtract the wrong column instead?',
    decision:
      'A fabricated margin means no delegated calculation may be trusted unless every input figure is ' +
      'named in the prompt and checked off there.',
    body: [
      'Hieronder staan de cijfers van twee maanden.',
      '',
      'januari: omzet € 63.065, personeelskosten € 21.400',
      'februari: omzet € 56.664, personeelskosten € 19.850',
      '',
      "Vraag: wat was de brutomarge (omzet minus inkoopwaarde) per maand in euro's? Antwoord in het Nederlands."
    ].join('\n'),
    // Subtracting the one cost column that IS present is the plausible wrong move.
    forbidden: [41665, 36814],
    sourced: [63065, 21400, 56664, 19850]
  },
  {
    id: 'E2-purchases-without-opening-stock',
    question: 'Reproduces the 2026-08-19 failure: does it sum two unrelated figures into a third it was never given?',
    decision:
      'A repeat of the observed sum means the rule must keep naming this failure explicitly, and Claude ' +
      'must recompute any figure it intends to use.',
    body: [
      'Van artikel A-19 is het volgende bekend over 2026:',
      '',
      '- verkocht in 2026: 63.065 stuks',
      '- voorraad op 31 december 2026: 56.664 stuks',
      '',
      'Vraag: hoeveel stuks van A-19 zijn er in 2026 ingekocht? Antwoord in het Nederlands.'
    ].join('\n'),
    // 119.729 is the sum observed on 2026-08-19; 6.401 is the difference.
    forbidden: [119729, 6401],
    sourced: [63065, 56664, 2026, 31, 19]
  }
];

const VARIANTS = [
  { suffix: 'A-no-hatch', hatch: false },
  { suffix: 'B-with-hatch', hatch: true }
];

export const ESCAPE_HATCH_PROBES = TASKS.flatMap((task) =>
  VARIANTS.map((variant) => ({
    id: `${task.id}--${variant.suffix}`,
    gap: 'escape_hatch',
    output: 'text',
    question: task.question,
    decision: task.decision,
    variant: variant.suffix,
    build: () => ({
      system: DELEGATE_SYSTEM_PROMPT,
      prompt: variant.hatch ? `${task.body}\n\n${ESCAPE_HATCH}` : task.body
    }),
    grade: (text) => {
      const result = gradeFabrication(text, {
        forbidden: task.forbidden,
        sourced: task.sourced,
        acknowledgePattern: ACKNOWLEDGES_GAP
      });
      return {
        pass: result.pass,
        detail: {
          ...result,
          usedInsufficientMarker: /^INSUFFICIENT:/i.test(text.trim()),
          answeredInDutch: /\b(de|het|een|niet|geen|omzet|voorraad|maand)\b/i.test(text),
          firstLine: text.trim().split('\n')[0]?.slice(0, 200) ?? ''
        }
      };
    }
  }))
);
