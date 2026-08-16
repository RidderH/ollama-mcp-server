/** Shared shaping of tool results, so every tool answers in the same way. */

import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { ActionableError, ResponseFormat } from '../types.js';
import { asJsonBlock, truncate } from './format.js';

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Build a successful result carrying both a rendered text view and the
 * structured object, truncating the text view if it runs long.
 */
export function respond<T extends Record<string, unknown>>(
  structured: T,
  markdown: string,
  format: ResponseFormat
): CallToolResult {
  const body = format === ResponseFormat.JSON ? asJsonBlock(structured) : markdown;
  return {
    content: [{ type: 'text', text: truncate(body).text }],
    structuredContent: structured
  };
}

/**
 * Build an error result. Tool failures are reported inside the result rather
 * than as protocol errors so the calling agent can read them and adapt.
 */
export function respondError(error: unknown): CallToolResult {
  const message =
    error instanceof ActionableError
      ? error.message
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }]
  };
}

/**
 * Emit a progress notification when the client asked for one.
 *
 * Delegated work runs for minutes at a time, and without this the client has
 * no signal between request and response. Failures to notify are swallowed —
 * losing a progress tick must never fail the underlying work.
 */
export async function reportProgress(
  extra: ToolExtra,
  progress: number,
  total: number | undefined,
  message: string
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress, ...(total !== undefined ? { total } : {}), message }
    });
  } catch {
    /* progress is best-effort */
  }
}

export interface ProgressCounter {
  /** Emit one labelled progress step. */
  step: (message: string) => Promise<void>;
  /**
   * Emit "<label> — still running (Ns elapsed)" every `intervalMs` until the
   * returned stop function is called. Call stop in a finally block.
   */
  heartbeat: (label: string, intervalMs?: number) => () => void;
}

/**
 * A per-call progress sequence whose values only ever increase, so discrete
 * steps and heartbeat ticks can interleave without the client seeing progress
 * run backwards.
 *
 * The heartbeat exists to keep the connection audibly alive during a long
 * generation: clients enforce an idle timeout, and a call that goes silent for
 * the whole generation gets aborted, leaving the calling agent to continue
 * without the result.
 */
export function progressCounter(extra: ToolExtra, heartbeatMs: number): ProgressCounter {
  let sequence = 0;

  const step = (message: string): Promise<void> => {
    sequence += 1;
    return reportProgress(extra, sequence, undefined, message);
  };

  const heartbeat = (label: string, intervalMs = heartbeatMs): (() => void) => {
    if (extra._meta?.progressToken === undefined) return () => {};
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      void step(`${label} — still running (${elapsed}s elapsed)`);
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  };

  return { step, heartbeat };
}
