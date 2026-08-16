/** Cleanup of raw model output, plus shared response shaping. */

import { CHARACTER_LIMIT } from '../constants.js';

/**
 * Remove reasoning blocks emitted by thinking models (Qwen3, DeepSeek-R1 and
 * friends). These are commentary, never part of the requested answer, and left
 * in place they would be written straight into a source file.
 */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // An unterminated block means generation was cut off mid-thought; drop the
    // opener and everything after it rather than emitting half a monologue.
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

/**
 * Unwrap a single fenced code block.
 *
 * Instructed to return only file contents, small models still tend to wrap the
 * answer in a fence. Only a fence enclosing the *whole* response is removed, so
 * a file that legitimately contains fenced blocks (markdown, docs) survives.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  if (!match || match[1] === undefined) return trimmed;
  // A response containing more than one fence is not a single wrapped block.
  const innerFences = match[1].match(/^```/gm);
  if (innerFences && innerFences.length > 0) return trimmed;
  return match[1];
}

/** Full cleanup pipeline for output destined for a file on disk. */
export function cleanFileOutput(text: string): string {
  return stripCodeFences(stripThinkBlocks(text));
}

export interface Truncation {
  text: string;
  truncated: boolean;
  message?: string;
}

/** Clamp a string to CHARACTER_LIMIT, explaining the cut when one happens. */
export function truncate(text: string, limit: number = CHARACTER_LIMIT): Truncation {
  if (text.length <= limit) return { text, truncated: false };
  const message =
    `Output truncated from ${text.length} to ${limit} characters. Narrow the request or process ` +
    `fewer files per call to see the rest.`;
  return { text: `${text.slice(0, limit)}\n\n[${message}]`, truncated: true, message };
}

/** Render a value as a fenced JSON block for markdown responses. */
export function asJsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Human-readable byte size, e.g. "4.7 GB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
