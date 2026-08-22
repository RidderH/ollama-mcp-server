/**
 * Gap #1 — `ollama_transform_files`, which the delegation rule currently says
 * nothing about at all.
 *
 * Each probe replays what the tool sends for one file and grades the bytes it
 * would have written to disk. Every probe states the routing decision its
 * result changes; a probe that cannot name one does not belong here.
 */

import { readFileSync } from 'node:fs';

import { gradeNoNewImports, gradePreservation, gradeUnchanged, isCannotComply } from '../lib/graders.mjs';
import { TRANSFORM_SYSTEM_PROMPT, transformPrompt } from '../lib/prompts.mjs';

const MIN_OUTPUT_RATIO = 0.4;
const SHRINK_CHECK_MIN_BYTES = 200;
const JSDOC_LINE = /^\s*(\/\*\*|\*|\*\/)/;

function fixture(name) {
  return readFileSync(new URL(`../fixtures/transform/${name}`, import.meta.url), 'utf8');
}

/** Would the tool's own shrink guard have thrown this output away? */
function rejectedByShrinkGuard(before, after) {
  return before.length >= SHRINK_CHECK_MIN_BYTES && after.length < before.length * MIN_OUTPUT_RATIO;
}

const JSDOC_INSTRUCTION =
  'Add a JSDoc block immediately above every exported function, describing what the function does ' +
  'and naming its parameters. Change nothing else.';

function jsdocProbe({ id, file, question, decision }) {
  const before = fixture(file);
  return {
    id,
    gap: 'transform_files',
    question,
    decision,
    build: () => ({
      system: TRANSFORM_SYSTEM_PROMPT,
      prompt: transformPrompt(`evals/fixtures/transform/${file}`, JSDOC_INSTRUCTION, before)
    }),
    grade: (cleaned) => {
      const preservation = gradePreservation(before, cleaned, { allowInserted: JSDOC_LINE });
      const imports = gradeNoNewImports(before, cleaned);
      const shrunk = rejectedByShrinkGuard(before, cleaned);
      const refused = isCannotComply(cleaned);

      return {
        pass: preservation.pass && imports.pass && !shrunk && !refused,
        detail: {
          bytesBefore: before.length,
          bytesAfter: cleaned.length,
          linesBefore: preservation.linesBefore,
          linesAfter: preservation.linesAfter,
          preservedRatio: Number(preservation.preservedRatio.toFixed(4)),
          missingLineCount: preservation.missingLines.length,
          missingLines: preservation.missingLines.slice(0, 5),
          unexpectedInsertionCount: preservation.unexpectedInsertions.length,
          unexpectedInsertions: preservation.unexpectedInsertions.slice(0, 5),
          inventedImports: imports.newImports,
          rejectedByShrinkGuard: shrunk,
          refusedWithCannotComply: refused
        }
      };
    }
  };
}

const NO_OP_INSTRUCTION = 'Convert every `var` declaration in this file to `const`. Change nothing else.';

const RENAME_INSTRUCTION =
  'The helper currently imported from "./utils.js" has been renamed in that module. Update this file ' +
  'to import and call it under its new name.';

export const TRANSFORM_PROBES = [
  jsdocProbe({
    id: 'T1-preserve-small',
    file: 'small.js',
    question: 'On a 93-line file, does a narrow edit leave every other line byte-identical?',
    decision:
      'A clean pass means small-file transforms can be reviewed by diff alone. Any lost line means ' +
      'dry_run is mandatory, not advisory.'
  }),
  jsdocProbe({
    id: 'T3-preserve-large',
    file: 'large.js',
    question: 'Does the same edit survive a 297-line, 9 KB file, and inside the 300 s MCP ceiling?',
    decision: 'Fixes the file size above which transform calls must be split rather than attempted.'
  }),
  {
    id: 'T2-no-op-instruction',
    gap: 'transform_files',
    question: 'Given an instruction that matches nothing in the file, does the model leave it alone?',
    decision:
      'A gratuitous edit here means an instruction must never be aimed at a batch where some files ' +
      'are out of scope — every file has to match, or the batch has to be filtered first.',
    build: () => {
      const before = fixture('novar.js');
      return {
        system: TRANSFORM_SYSTEM_PROMPT,
        prompt: transformPrompt('evals/fixtures/transform/novar.js', NO_OP_INSTRUCTION, before)
      };
    },
    grade: (cleaned) => {
      const before = fixture('novar.js');
      const unchanged = gradeUnchanged(before, cleaned);
      const refused = isCannotComply(cleaned);
      const preservation = gradePreservation(before, cleaned, { allowInserted: /$^/ });
      return {
        pass: unchanged.pass || refused,
        detail: {
          identical: unchanged.pass,
          changedLines: unchanged.changedLines,
          refusedWithCannotComply: refused,
          missingLines: preservation.missingLines.slice(0, 5),
          unexpectedInsertions: preservation.unexpectedInsertions.slice(0, 5)
        }
      };
    }
  },
  {
    id: 'T4-unknowable-rename',
    gap: 'transform_files',
    question: 'Asked for a rename whose new name is not in the file, does it refuse or invent one?',
    decision:
      'An invented identifier means transform instructions may never reference anything outside the ' +
      'file being rewritten — the tool has no way to signal that it guessed.',
    build: () => {
      const before = fixture('crossfile.js');
      return {
        system: TRANSFORM_SYSTEM_PROMPT,
        prompt: transformPrompt('evals/fixtures/transform/crossfile.js', RENAME_INSTRUCTION, before)
      };
    },
    grade: (cleaned) => {
      const before = fixture('crossfile.js');
      const refused = isCannotComply(cleaned);
      const unchanged = gradeUnchanged(before, cleaned).pass;
      // The original name disappearing means a replacement was made up: the new
      // one cannot have come from anywhere but the model.
      const droppedOriginalName = !refused && !cleaned.includes('parseAmount');
      return {
        pass: refused || unchanged,
        detail: {
          refusedWithCannotComply: refused,
          leftFileUnchanged: unchanged,
          inventedReplacementName: droppedOriginalName,
          bytesAfter: cleaned.length,
          firstLines: cleaned.split('\n').slice(0, 3)
        }
      };
    }
  }
];
