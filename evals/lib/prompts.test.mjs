/**
 * Anti-drift guard for the prompt copies.
 *
 * If `src/tools/transform.ts` changes its system prompt, every transform probe
 * silently starts measuring an older tool. This fails instead.
 *
 * Run: npm run build && node --test evals/lib/prompts.test.mjs
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DELEGATE_SYSTEM_PROMPT, TRANSFORM_SYSTEM_PROMPT, transformPrompt } from './prompts.mjs';

const compiled = readFileSync(new URL('../../dist/tools/transform.js', import.meta.url), 'utf8');
const compiledDelegate = readFileSync(new URL('../../dist/tools/delegate.js', import.meta.url), 'utf8');

test('every line of the transform system prompt is present in the compiled tool', () => {
  for (const line of TRANSFORM_SYSTEM_PROMPT.split('\n')) {
    if (line === '') continue;
    assert.ok(
      compiled.includes(JSON.stringify(line).slice(1, -1)) || compiled.includes(line),
      `line missing from dist/tools/transform.js: ${line}`
    );
  }
});

test('the prompt has not gained lines the copy does not know about', () => {
  const shipped = /const TRANSFORM_SYSTEM_PROMPT = \[([\s\S]*?)\]\.join/.exec(compiled);
  assert.ok(shipped, 'could not locate TRANSFORM_SYSTEM_PROMPT in the compiled tool');
  const shippedLineCount = (shipped[1].match(/'/g) ?? []).length / 2;
  assert.equal(shippedLineCount, TRANSFORM_SYSTEM_PROMPT.split('\n').length);
});

test('the user message wraps instruction and file the way the tool does', () => {
  const built = transformPrompt('a.js', 'do a thing', 'const a = 1;');
  assert.ok(compiled.includes('<instruction>'), 'tool no longer wraps the instruction');
  assert.ok(compiled.includes('<file path='), 'tool no longer wraps the file');
  assert.equal(built, '<instruction>\ndo a thing\n</instruction>\n\n<file path="a.js">\nconst a = 1;\n</file>');
});

test('every line of the delegate system prompt is present in the compiled tool', () => {
  for (const line of DELEGATE_SYSTEM_PROMPT.split('\n')) {
    if (line === '') continue;
    assert.ok(
      compiledDelegate.includes(JSON.stringify(line).slice(1, -1)) || compiledDelegate.includes(line),
      `line missing from dist/tools/delegate.js: ${line}`
    );
  }
});

test('the delegate prompt has not gained lines the copy does not know about', () => {
  const shipped = /const DELEGATE_SYSTEM_PROMPT = \[([\s\S]*?)\]\.join/.exec(compiledDelegate);
  assert.ok(shipped, 'could not locate DELEGATE_SYSTEM_PROMPT in the compiled tool');
  const shippedLineCount = (shipped[1].match(/'/g) ?? []).length / 2;
  assert.equal(shippedLineCount, DELEGATE_SYSTEM_PROMPT.split('\n').length);
});
