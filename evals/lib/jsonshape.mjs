/**
 * Graders for structured output.
 *
 * A caller piping a delegated result into a program can fail in three
 * different places, and they call for three different responses:
 *
 *   1. it is not JSON            -> the caller needs an extractor, or a retry
 *   2. it is JSON of a wrong shape -> the caller needs a validator before use
 *   3. it is the right shape with wrong values -> nothing mechanical will catch it
 *
 * So the three are graded apart and reported apart. Collapsing them into one
 * pass rate hides which of the three a caller has to defend against, which is
 * the only thing the result is for.
 */

import { stripCodeFences } from './clean.mjs';

/**
 * Find the first balanced JSON value in a piece of prose.
 *
 * The model likes to introduce its answer ("Hier is het resultaat:"), which no
 * amount of fence stripping removes. Brace counting is string-aware, because
 * a `{` inside a value would otherwise leave the scan unbalanced forever.
 */
function scanForJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function tryParse(candidate) {
  if (candidate === undefined) return undefined;
  try {
    return { value: JSON.parse(candidate) };
  } catch {
    return undefined;
  }
}

/**
 * Parse a model answer at three increasing levels of caller effort.
 *
 * `level` names the cheapest one that worked, which is the routing fact: a
 * caller writing `JSON.parse(result.text)` succeeds only at `raw`. The
 * delegate tool strips think blocks but not fences, so `stripped` is work the
 * caller has to do itself.
 */
export function parseJsonOutput(text) {
  const trimmed = String(text).trim();

  const raw = tryParse(trimmed);
  const strippedText = stripCodeFences(trimmed);
  const stripped = raw ?? tryParse(strippedText);
  const scanned = stripped ?? tryParse(scanForJson(trimmed));

  const level = raw ? 'raw' : stripped ? 'stripped' : scanned ? 'scanned' : 'none';

  return {
    parsesRaw: raw !== undefined,
    parsesStripped: stripped !== undefined,
    parsesScanned: scanned !== undefined,
    fenced: strippedText !== trimmed,
    level,
    value: scanned?.value,
    error: scanned === undefined ? `no JSON at any level; answer began: ${trimmed.slice(0, 120)}` : undefined
  };
}

const TYPE_OF = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

/** Does the value satisfy `type`, allowing integer to stand in for number? */
function typeMatches(value, type) {
  const allowed = Array.isArray(type) ? type : [type];
  const actual = TYPE_OF(value);
  return allowed.some((name) => name === actual || (name === 'number' && actual === 'integer'));
}

/**
 * Validate against the JSON Schema subset the probes use.
 *
 * Deliberately small — type (including a nullable union), properties,
 * required, additionalProperties, items, enum — because it also has to be the
 * schema handed to Ollama's native `format`, and anything it cannot express is
 * a difference between the two variants rather than a measurement of them.
 * Every failure is collected, not just the first: one run tells you which
 * fields the model gets wrong, and stopping at the first would hide the rest.
 */
export function validateSchema(value, schema, path = '') {
  const errors = [];
  const at = path === '' ? 'root' : path;

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    const want = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
    errors.push(`${at}: expected type ${want}, got ${TYPE_OF(value)}`);
    return { pass: false, errors };
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is outside the enum [${schema.enum.join(', ')}]`);
  }

  if (TYPE_OF(value) === 'object' && schema.properties !== undefined) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: required field ${key} is missing`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties[key];
      const childPath = path === '' ? key : `${path}.${key}`;
      if (childSchema === undefined) {
        if (schema.additionalProperties === false) {
          errors.push(`${at}: unexpected field ${key}`);
        }
        continue;
      }
      errors.push(...validateSchema(child, childSchema, childPath).errors);
    }
  }

  if (TYPE_OF(value) === 'array' && schema.items !== undefined) {
    value.forEach((element, index) => {
      errors.push(...validateSchema(element, schema.items, `${path}[${index}]`).errors);
    });
  }

  return { pass: errors.length === 0, errors };
}

/**
 * Compare against ground truth, walking only what the ground truth names.
 *
 * Extra fields are a shape failure, not a content one, and `validateSchema`
 * already owns that verdict. Floats are compared with a tolerance because a
 * cent-exact sum written back through a float is not bit-exact.
 */
export function compareValues(actual, expected, { tolerance = 0.005, path = '' } = {}) {
  const mismatches = [];
  const at = path === '' ? 'root' : path;

  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      mismatches.push({ path: at, expected, actual });
      return { pass: false, mismatches };
    }
    for (const [key, child] of Object.entries(expected)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      mismatches.push(...compareValues(actual[key], child, { tolerance, path: childPath }).mismatches);
    }
    return { pass: mismatches.length === 0, mismatches };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push({ path: at, expected, actual });
      return { pass: false, mismatches };
    }
    if (actual.length !== expected.length) {
      mismatches.push({ path: `${at}.length`, expected: expected.length, actual: actual.length });
    }
    expected.forEach((child, index) => {
      mismatches.push(...compareValues(actual[index], child, { tolerance, path: `${path}[${index}]` }).mismatches);
    });
    return { pass: mismatches.length === 0, mismatches };
  }

  const equal =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) <= tolerance
      : actual === expected;

  if (!equal) mismatches.push({ path: at, expected, actual });
  return { pass: mismatches.length === 0, mismatches };
}
