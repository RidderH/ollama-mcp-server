/**
 * Gap #7 — Dutch number and language fidelity.
 *
 * Half of this gap was already answered by the runs on disk, for free: across
 * **135 Dutch-prompted answers in the existing corpus, not one prose answer
 * contained a word that exists in English and not in Dutch.** (A first scan
 * said nine did; all nine were false, because "is", "dat", "die" and "over"
 * are Dutch too, and three more were English comments inside a JavaScript
 * fixture the transform probes were told to preserve.)
 *
 * What that corpus cannot answer is the part the handoff actually worried
 * about: **length**. Its longest Dutch prose answer is 2.412 characters, some
 * 600 tokens. Drift that begins two thirds of the way into a long answer would
 * not show up in any run recorded so far, and would survive a spot check of
 * the opening paragraph.
 *
 * So these probes hold the document and the question fixed and vary only how
 * much prose is asked for. Both are graded on the same two axes: does every
 * figure come back in Dutch notation, and does the language hold to the end.
 */

import { readFileSync } from 'node:fs';

import { gradeNumberEcho, gradeDutchLanguage } from '../lib/dutch.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const DOC = readFileSync(new URL('../fixtures/dutch/kwartaal.txt', import.meta.url), 'utf8').trim();

/**
 * The figures the answer has to carry, chosen because each is a different way
 * Dutch notation can break: a thousands group with a decimal tail, a bare
 * thousands group, and a decimal under a thousand.
 */
const FIGURES = ['468.301,25', '412.750,80', '224.907,40', '128.945,75', '4.017', '3.482', '116,58', '118,54'];

const LENGTHS = [
  {
    id: 'D1-short-answer',
    ask: 'Vat de ontwikkeling van Q1 naar Q2 samen in maximaal vijf zinnen. Noem daarbij de omzet van beide kwartalen, de inkoopwaarde van beide kwartalen, de personeelskosten van Q2, het aantal verkochte stuks in beide kwartalen en de gemiddelde orderwaarde in beide kwartalen.',
    question: 'In a short Dutch answer, do the figures come back in Dutch notation and the prose stay Dutch?',
    decision:
      'The control. If a short answer already anglicises a figure, length is not the variable and the ' +
      'problem is the model, not the drift.'
  },
  {
    id: 'D2-long-answer',
    ask:
      'Schrijf een uitgebreide toelichting bij deze cijfers, in het Nederlands. Behandel elke post uit ' +
      'de tabel in een eigen alinea van minstens vier zinnen: wat het cijfer in Q1 was, wat het in Q2 ' +
      'was, hoe groot het verschil is en wat daarvan de mogelijke oorzaak kan zijn. Noem in elke alinea ' +
      'de bedragen zoals ze in de tabel staan. Sluit af met een alinea over de gemiddelde orderwaarde en ' +
      'het aantal verkochte stuks.',
    question:
      'The corpus has no Dutch answer longer than ~600 tokens. Over several times that, does the ' +
      'language hold and do the figures keep their Dutch notation?',
    decision:
      'Decides whether a long Dutch write-up can be delegated at all, or whether only short answers can. ' +
      'Drift beginning late in an answer is the dangerous case: the opening reads fine, so a spot check ' +
      'passes and the tail ships.'
  },
  {
    id: 'D3-very-long-answer',
    ask:
      'Schrijf een volledige managementrapportage in het Nederlands bij deze cijfers. Behandel elke post ' +
      'uit de tabel in een eigen alinea van minstens acht zinnen: het cijfer in Q1, het cijfer in Q2, het ' +
      'verschil in euro\'s en in procenten, mogelijke oorzaken, en wat het betekent voor de rest van het ' +
      'jaar. Noem in elke alinea de bedragen zoals ze in de tabel staan. Schrijf daarna een alinea over ' +
      'de marge, een alinea over de gemiddelde orderwaarde en het aantal verkochte stuks, een alinea met ' +
      'de drie grootste risico\'s, en sluit af met vijf concrete aanbevelingen, elk met een toelichting ' +
      'van minstens drie zinnen.',
    question:
      'Near the generation budget the rule file already sets — some 2.500 to 3.500 tokens — does the ' +
      'Dutch still hold, and do the figures still carry their separators?',
    decision:
      'Sets the length at which a Dutch write-up may be delegated. The rule tells you to budget about ' +
      '5.000 generated tokens; this establishes whether fidelity survives that far, or whether length ' +
      'has to be capped for a different reason than the wall clock.'
  }
];

export function gradeDutch(text) {
  const numbers = gradeNumberEcho(text, FIGURES);
  const language = gradeDutchLanguage(text);

  return {
    pass: numbers.pass && language.pass,
    detail: {
      notationHeld: numbers.pass,
      languageHeld: language.pass,
      exact: numbers.exact.length,
      reformatted: numbers.reformatted,
      anglicised: numbers.anglicised,
      missing: numbers.missing,
      englishWords: language.englishWords,
      englishCount: language.englishCount,
      // Where the first English word sits as a fraction of the answer: late
      // drift is the case a spot check of the opening would miss.
      firstDriftAt: language.firstDriftAt,
      chars: language.length
    }
  };
}

export const DUTCH_PROBES = LENGTHS.map((variant) => ({
  id: variant.id,
  gap: 'dutch_fidelity',
  output: 'text',
  question: variant.question,
  decision: variant.decision,
  variant: variant.id,
  build: () => ({
    system: DELEGATE_SYSTEM_PROMPT,
    prompt: [DOC, '', variant.ask].join('\n'),
    // Thinking off: gap #5 found the answer is cleaner without it, and a
    // thinking phase on a long answer would spend the wall-clock budget
    // before the prose this probe is about had been written.
    options: { disableThinking: true }
  }),
  grade: (text) => gradeDutch(text)
}));
