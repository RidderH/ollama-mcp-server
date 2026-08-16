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
  total: number,
  message: string
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress, total, message }
    });
  } catch {
    /* progress is best-effort */
  }
}
