/**
 * Port of `src/services/format.ts`.
 *
 * The probes must judge what the transform tool would have written to disk,
 * not the raw completion, so they apply the same cleanup. Kept as a copy
 * rather than an import because `src` is TypeScript and the evals run without
 * a build step; `evals/lib/clean.test.mjs` pins it to the original's contract.
 */

export function stripThinkBlocks(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

export function stripCodeFences(text) {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  if (!match || match[1] === undefined) return trimmed;
  const innerFences = match[1].match(/^```/gm);
  if (innerFences && innerFences.length > 0) return trimmed;
  return match[1];
}

export function cleanFileOutput(text) {
  return stripCodeFences(stripThinkBlocks(text));
}
