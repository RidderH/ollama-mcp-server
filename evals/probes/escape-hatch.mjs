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

import { gradeFabrication, gradeNamedGap } from '../lib/graders.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

/** The sentence under test, quoted from the rule file verbatim. */
export const ESCAPE_HATCH =
  'Heb je een getal nodig dat er niet staat, reken het dan niet uit en verzin het niet, maar ' +
  'schrijf op welk getal je mist.';

const ACKNOWLEDGES_GAP =
  // "ontbreken" has no double e, so /ontbreek/ alone silently misses the
  // most common Dutch phrasing of the whole point. Both stems are required.
  /INSUFFICIENT|ontbrek|ontbreek|\bmis\w*\b|niet gegeven|niet vermeld|niet beschikbaar|onbekend|kan ik niet|niet af te leiden|niet te berekenen|geen gegevens/i;

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
  },
  {
    id: 'E3-implicit-gap-in-a-judgement',
    question:
      'When the missing figure is never asked for — only needed to answer — does it flag the gap or fill it?',
    decision:
      'E1 and E2 ask straight out for a figure that is absent, which is the easy case. This is the ' +
      'shape of the 2026-08-19 failure: a judgement question that silently requires a quantity nobody ' +
      'requested. If it fabricates here, no delegated judgement over a table can be trusted, however ' +
      'well it refuses a direct question.',
    body: [
      'Maandrapportage artikel A-19 — augustus 2026',
      '',
      'verkocht:            63.065 stuks',
      'retour ontvangen:     2.140 stuks',
      'voorraad per 31-08:  56.664 stuks',
      'magazijnkosten:      € 18.900',
      '',
      'Norm: de inkoop van een maand mag maximaal 10% boven de verkoop van die maand liggen.',
      '',
      'Vraag: welke posten uit deze rapportage verdienen een waarschuwing in het maandoverzicht? ' +
        'Licht per post toe. Antwoord in het Nederlands.'
    ].join('\n'),
    // The norm cannot be checked: the inkoop figure it refers to is not in the
    // table. 119.729 is the sum observed on 2026-08-19; the rest are the other
    // ways two of these rows combine into a plausible-looking purchase volume.
    forbidden: [119729, 121869, 65205, 6401],
    // Everything legitimately present or derivable, so the unsourced metric
    // stays readable: net sales and the 110% norm threshold are fair game.
    sourced: [63065, 2140, 56664, 18900, 31, 8, 2026, 19, 10, 100, 110, 60925, 69371.5, 69372, 69371, 67017.5, 67018, 67017],
    namedGap: {
      topicPattern: /inkoop|ingekocht/i,
      missingPattern:
        /INSUFFICIENT|ontbrek|ontbreek|\bmis\w*\b|niet vermeld|niet gegeven|niet beschikbaar|niet op te maken|onbekend|geen|kan niet|kunnen niet|niet te (?:berekenen|controleren|toetsen|beoordelen)/i
    }
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
      // A task whose question never mentions the missing figure needs the
      // stricter check: hedging in some other sentence is not flagging it.
      const named = task.namedGap ? gradeNamedGap(text, task.namedGap) : undefined;
      return {
        pass: named ? !result.trapHit && named.pass : result.pass,
        detail: {
          ...result,
          ...(named ? { namedGap: named } : {}),
          usedInsufficientMarker: /^INSUFFICIENT:/i.test(text.trim()),
          answeredInDutch: /\b(de|het|een|niet|geen|omzet|voorraad|maand)\b/i.test(text),
          firstLine: text.trim().split('\n')[0]?.slice(0, 200) ?? ''
        }
      };
    }
  }))
);
