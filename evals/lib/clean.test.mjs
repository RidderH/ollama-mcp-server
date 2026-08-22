/**
 * Anti-drift guard for the `clean.mjs` port.
 *
 * `clean.mjs` duplicates `src/services/format.ts` so the evals can run without
 * a build step. A copy that silently diverges would make every transform probe
 * judge different bytes than the tool writes, so this pins the two together
 * against the compiled original.
 *
 * Run: npm run build && node --test evals/lib/clean.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import * as original from '../../dist/services/format.js';
import * as port from './clean.mjs';

const CASES = [
  'plain text',
  '<think>reasoning</think>const a = 1;',
  '<thinking>reasoning</thinking>\nconst a = 1;',
  '<think>cut off mid-thought and never closed',
  '```js\nconst a = 1;\n```',
  '```\nconst a = 1;\n```',
  '# Doc\n\n```js\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```',
  '  \n CANNOT_COMPLY \n ',
  '',
  'no fence but a stray ``` inside'
];

test('cleanFileOutput matches the compiled original on every case', () => {
  for (const input of CASES) {
    assert.equal(port.cleanFileOutput(input), original.cleanFileOutput(input), `diverged on: ${JSON.stringify(input)}`);
  }
});

test('stripThinkBlocks and stripCodeFences match the compiled original', () => {
  for (const input of CASES) {
    assert.equal(port.stripThinkBlocks(input), original.stripThinkBlocks(input), `think: ${JSON.stringify(input)}`);
    assert.equal(port.stripCodeFences(input), original.stripCodeFences(input), `fences: ${JSON.stringify(input)}`);
  }
});
