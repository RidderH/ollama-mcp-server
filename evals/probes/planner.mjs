/**
 * Gap #3 — the planner pattern, the rule file's strongest recommendation and
 * its thinnest evidence: one `awk` one-liner, once, on 2026-08-19.
 *
 * The claim is that a model which cannot count 500 rows can still write the
 * command that counts them, from the schema alone, without seeing a row. That
 * is testable the only way such a claim can be: run what it writes against a
 * fixture whose answer is known independently.
 *
 * Each probe sends the header, one sample row and the question — never the
 * data — and states the exact output the command must print, so a wrong
 * separator or a missing decimal is a failure rather than a judgement call.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stripCodeFences } from '../lib/clean.mjs';
import { compareOutput, runCommand } from '../lib/exec.mjs';
import { DELEGATE_SYSTEM_PROMPT } from '../lib/prompts.mjs';

const FIXTURES = new URL('../fixtures/planner/', import.meta.url);
const TRUTH = JSON.parse(readFileSync(new URL('ground-truth.json', FIXTURES), 'utf8'));

/**
 * A throwaway directory holding nothing but copies of the fixtures.
 *
 * Built fresh per call rather than cleaned up afterwards: a run that dies
 * mid-command must not leave the next one grading a half-written file.
 */
function prepareSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'planner-probe-'));
  for (const name of ['boekingen.csv', 'boekingen.json', 'boekingen.sql']) {
    copyFileSync(new URL(name, FIXTURES), join(dir, name));
  }
  execSync('sqlite3 db.sqlite < boekingen.sql', { cwd: dir, timeout: 30_000 });
  return dir;
}

const SCHEMA_NOTES = [
  'De kolom `categorie` komt voor in wisselend hoofdlettergebruik en staat soms met spaties eromheen.',
  'De kolom `bedrag` staat in Nederlandse notatie: punt als duizendtalscheiding, komma als decimaalteken.',
  'Sommige rijen hebben een leeg bedrag.'
].join('\n');

const TOTAL_QUESTION =
  "Vraag: wat is het totale bedrag over alle rijen waarvan de categorie 'inkoop' is, ongeacht " +
  'hoofdletters of spaties eromheen?';

const ONE_NUMBER_CONTRACT = [
  'Het commando moet exact één regel afdrukken: het totaal als getal met een punt als decimaalteken',
  'en precies twee decimalen, zonder valutateken en zonder verdere tekst.',
  '',
  'Geef alleen het commando terug, op één regel, zonder toelichting en zonder code-fences.'
].join('\n');

const SOURCES = {
  csv: [
    'Bestand: boekingen.csv, in de huidige map.',
    'Scheidingsteken: komma. Velden kunnen tussen dubbele aanhalingstekens staan en zo\'n veld kan zelf komma\'s bevatten.',
    'Kopregel: datum,omschrijving,categorie,bedrag,aantal',
    '',
    'Eén voorbeeldregel:',
    '2026-07-19,"Peeters, B.V."," Inkoop ","1.448,18",4'
  ].join('\n'),
  json: [
    'Bestand: boekingen.json, in de huidige map. Het bevat één JSON-array met objecten.',
    '',
    'Eén voorbeeldobject:',
    '{"datum":"2026-07-19","omschrijving":"Peeters, B.V.","categorie":" Inkoop ","bedrag":"1.448,18","aantal":4}'
  ].join('\n'),
  sqlite: [
    'Database: db.sqlite, in de huidige map, met één tabel `boekingen`.',
    'Kolommen: datum TEXT, omschrijving TEXT, categorie TEXT, bedrag TEXT, aantal INTEGER.',
    '',
    'Eén voorbeeldrij:',
    "('2026-07-19', 'Peeters, B.V.', ' Inkoop ', '1.448,18', 4)"
  ].join('\n')
};

function plannerProbe({ id, tool, source, question, contract, expected, instruction }) {
  return {
    id,
    gap: 'planner_pattern',
    output: 'text',
    question,
    decision:
      'The rule file tells Claude to reach for this first whenever a task scales with row count. ' +
      'Every tool that fails here is a tool that advice must stop covering.',
    build: () => ({
      system: DELEGATE_SYSTEM_PROMPT,
      prompt: [
        'Je krijgt het schema van een gegevensbron, niet de inhoud.',
        '',
        source,
        '',
        SCHEMA_NOTES,
        '',
        question,
        '',
        instruction,
        contract
      ].join('\n')
    }),
    grade: async (text) => {
      const cleaned = stripCodeFences(text).trim();
      const lines = cleaned.split('\n').filter((line) => line.trim() !== '');
      const extraProse = lines.length > 1;
      // Instructed to answer with the command alone; when it does not, grade
      // the first line that actually invokes the named tool rather than
      // failing it for the prose.
      const command = extraProse ? (lines.find((line) => line.includes(tool)) ?? lines[0]) : cleaned;

      const dir = prepareSandbox();
      const run = await runCommand(command, { cwd: dir, timeoutMs: 20_000 });
      const comparison = compareOutput(run.stdout, expected);

      return {
        pass: run.ran && !run.timedOut && comparison.pass,
        detail: {
          command: command.slice(0, 400),
          extraProse,
          refused: run.refused,
          refusedFor: run.refusedFor,
          timedOut: run.timedOut,
          exitCode: run.exitCode,
          expected,
          got: comparison.got.slice(0, 200),
          stderr: (run.stderr ?? '').trim().split('\n')[0]?.slice(0, 200) ?? ''
        }
      };
    }
  };
}

export const PLANNER_PROBES = [
  plannerProbe({
    id: 'P1-awk-csv-total',
    tool: 'awk',
    source: SOURCES.csv,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    instruction: 'Schrijf één shell-commando, gebaseerd op awk, dat dit antwoord berekent.'
  }),
  plannerProbe({
    id: 'P2-jq-json-total',
    tool: 'jq',
    source: SOURCES.json,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    instruction: 'Schrijf één shell-commando, gebaseerd op jq, dat dit antwoord berekent.'
  }),
  plannerProbe({
    id: 'P3-sqlite-total',
    tool: 'sqlite3',
    source: SOURCES.sqlite,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    instruction: 'Schrijf één shell-commando met sqlite3 dat dit antwoord berekent.'
  }),
  plannerProbe({
    id: 'P4-python-csv-total',
    tool: 'python3',
    source: SOURCES.csv,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    instruction: "Schrijf één shell-commando van de vorm python3 -c '...' dat dit antwoord berekent."
  }),
  plannerProbe({
    id: 'P6-awk-csv-total-dialect-named',
    tool: 'awk',
    source: SOURCES.csv,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    // P1 minus one assumption. If naming the dialect is what fixes it, that
    // belongs in the rule as a required line of every planner prompt; if it
    // does not, the pattern needs a verification step instead.
    instruction: [
      'Schrijf één shell-commando, gebaseerd op awk, dat dit antwoord berekent.',
      'Let op: dit draait op macOS met de BSD-versie van awk, niet gawk.',
      'Uitbreidingen als FPAT, gensub() en IGNORECASE bestaan daar niet en worden genegeerd.'
    ].join('\n')
  }),
  plannerProbe({
    id: 'P7-jq-json-total-pitfall-named',
    tool: 'jq',
    source: SOURCES.json,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    // P2 plus a hint built to the same specification as P6's: name the
    // environment, name the wrong assumption, say it does not exist here.
    // It does not say what to write instead, so a pass means the model had
    // the knowledge and only the assumption was in the way -- which is what
    // decides whether "name the pitfall" is a general prompt rule or an awk
    // coincidence.
    instruction: [
      'Schrijf één shell-commando, gebaseerd op jq, dat dit antwoord berekent.',
      'Let op: dit draait op jq 1.8. In jq worden de argumenten van een functie gescheiden door een',
      'puntkomma, niet door een komma. Een aanroep als gsub("a", "b") bestaat daar niet en geeft een fout.'
    ].join('\n')
  }),
  plannerProbe({
    id: 'P8-jq-pitfall-named-neutral-hint',
    tool: 'jq',
    source: SOURCES.json,
    question: TOTAL_QUESTION,
    contract: ONE_NUMBER_CONTRACT,
    expected: TRUTH.totalInkoop,
    // P7 rerun with the confound removed. P7's hint spelled the counter-example
    // out as gsub("a", "b") -- a comma followed by a space -- and the runs that
    // took the hint then wrote ", " as the search pattern where the unhinted
    // runs had written ",". The wording is the prime suspect, so this version
    // names the rule with placeholders and gives no literal string to copy.
    instruction: [
      'Schrijf één shell-commando, gebaseerd op jq, dat dit antwoord berekent.',
      'Let op: dit draait op jq 1.8. In jq worden de argumenten van een functie gescheiden door een',
      'puntkomma en niet door een komma; een komma tussen argumenten geeft een foutmelding.'
    ].join('\n')
  }),
  plannerProbe({
    id: 'P5-awk-csv-top3',
    tool: 'awk',
    source: SOURCES.csv,
    question:
      'Vraag: welke drie categorieën hebben het hoogste totaalbedrag, en wat is dat totaal per categorie? ' +
      'Normaliseer de categorie naar kleine letters zonder omringende spaties.',
    contract: [
      'Het commando moet exact drie regels afdrukken, aflopend op totaal, elke regel opgebouwd als',
      'categorie, dan een tab, dan het totaal met een punt als decimaalteken en precies twee decimalen.',
      '',
      'Geef alleen het commando terug, op één regel, zonder toelichting en zonder code-fences.'
    ].join('\n'),
    expected: TRUTH.top3,
    instruction: 'Schrijf één shell-commando, gebaseerd op awk, dat dit antwoord berekent.'
  })
];
