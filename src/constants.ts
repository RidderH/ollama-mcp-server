/**
 * Configuration and shared constants.
 *
 * Everything here is overridable by environment variable so the server can be
 * pointed at a different Ollama host or model without editing code.
 */

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Base URL of the Ollama HTTP API. */
export const OLLAMA_HOST = envString('OLLAMA_HOST', 'http://127.0.0.1:11434').replace(/\/+$/, '');

/** Model used when a tool call does not name one explicitly. */
export const DEFAULT_MODEL = envString('OLLAMA_MCP_MODEL', 'qwen3.8:27b-mlx');

/**
 * Context window passed to Ollama as `num_ctx`.
 *
 * Ollama defaults to a small window (4096 on most builds) and silently
 * truncates anything longer, which looks like the model "getting dumber"
 * rather than an error. We always send an explicit value.
 */
export const DEFAULT_NUM_CTX = envInt('OLLAMA_MCP_NUM_CTX', 32768);

/** Ceiling for a single Ollama request. Local generation on CPU is slow. */
export const REQUEST_TIMEOUT_MS = envInt('OLLAMA_MCP_TIMEOUT_MS', 600_000);

/**
 * Interval between progress heartbeats while a generation is in flight.
 *
 * MCP clients abort a call that stays silent too long (Claude Code's idle
 * timeout is 30 minutes on stdio, 5 on HTTP), and a single local generation
 * can run for many minutes with no protocol traffic at all. The heartbeat is
 * what keeps the client waiting on the result instead of timing out and
 * moving on without it.
 */
export const HEARTBEAT_MS = envInt('OLLAMA_MCP_HEARTBEAT_MS', 10_000);

/** Root directory that all file paths must resolve inside of. */
export const WORKSPACE_ROOT = envString('OLLAMA_MCP_ROOT', process.cwd());

/** Maximum characters in a single tool response before it gets truncated. */
export const CHARACTER_LIMIT = 25_000;

/** Refuse to read a context file larger than this; it would blow the window. */
export const MAX_FILE_BYTES = envInt('OLLAMA_MCP_MAX_FILE_BYTES', 400_000);

/** Upper bound on files accepted by a single transform call. */
export const MAX_TRANSFORM_FILES = 50;

/** Default sampling temperature. Low, because these are mechanical tasks. */
export const DEFAULT_TEMPERATURE = 0.2;

/**
 * A rewritten file shorter than this fraction of the original is treated as a
 * failed generation rather than written to disk. Small local models
 * occasionally return a truncated file or a one-line apology; without this
 * guard that response would silently destroy the file's contents.
 */
export const MIN_OUTPUT_RATIO = 0.4;

/** Files below this size skip the shrink check — small files vary too much. */
export const SHRINK_CHECK_MIN_BYTES = 200;

export const SERVER_NAME = 'ollama-mcp-server';
export const SERVER_VERSION = '1.0.0';
