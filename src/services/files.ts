/** Sandboxed filesystem access. */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { MAX_FILE_BYTES, WORKSPACE_ROOT } from '../constants.js';
import { ActionableError } from '../types.js';

const ROOT = resolve(WORKSPACE_ROOT);

/**
 * Resolve a caller-supplied path and confirm it stays inside the workspace
 * root. Relative paths resolve against the root, not the process cwd, so the
 * two cannot drift apart.
 */
export function resolveWithinRoot(candidate: string): string {
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(ROOT, candidate);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ActionableError(
      `Path '${candidate}' resolves outside the workspace root (${ROOT}) and was refused. ` +
        `Pass a path inside the workspace, or restart the server with OLLAMA_MCP_ROOT set to the ` +
        `directory you want to expose.`
    );
  }
  return absolute;
}

/** Read a UTF-8 file, refusing anything large enough to overflow the window. */
export async function readTextFile(candidate: string): Promise<string> {
  const path = resolveWithinRoot(candidate);

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ActionableError(`File not found: '${candidate}'. Check the path is correct and relative to ${ROOT}.`);
    }
    if (code === 'EACCES') {
      throw new ActionableError(`Permission denied reading '${candidate}'.`);
    }
    throw new ActionableError(`Could not stat '${candidate}': ${error instanceof Error ? error.message : String(error)}`);
  }

  if (size > MAX_FILE_BYTES) {
    throw new ActionableError(
      `File '${candidate}' is ${size} bytes, over the ${MAX_FILE_BYTES}-byte limit. A file this large will ` +
        `not fit a local model's context window. Pass a smaller file, or raise OLLAMA_MCP_MAX_FILE_BYTES ` +
        `together with num_ctx if you are sure.`
    );
  }

  return readFile(path, 'utf8');
}

export async function writeTextFile(candidate: string, content: string): Promise<void> {
  const path = resolveWithinRoot(candidate);
  await writeFile(path, content, 'utf8');
}

export { ROOT as WORKSPACE_ROOT_RESOLVED };
