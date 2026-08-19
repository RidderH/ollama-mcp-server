/** Sandboxed filesystem access. */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { MAX_FILE_BYTES, WORKSPACE_ROOT } from '../constants.js';
import { ActionableError, type ContextFile } from '../types.js';

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

/** Read a file's bytes, mapping filesystem failures onto actionable messages. */
async function readWithinRoot(candidate: string): Promise<Buffer> {
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

  return readFile(path);
}

/** Leading bytes that identify the image formats Ollama's vision models accept. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The image format of these bytes, or undefined if they are not an image. */
function imageTypeOf(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const head = buffer.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (head.startsWith('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return undefined;
}

/**
 * Whether these bytes would turn to nonsense when decoded as UTF-8.
 *
 * Reading a PDF or a spreadsheet as text does not fail — it yields a wall of
 * replacement characters that reaches the model as a huge, meaningless prompt.
 * A null byte or a scattering of replacement characters is enough to tell.
 */
function looksBinary(buffer: Buffer): boolean {
  const window = buffer.subarray(0, 8000);
  if (window.includes(0)) return true;
  const text = window.toString('utf8');
  const replacements = text.match(/�/g)?.length ?? 0;
  return replacements > Math.max(1, text.length / 1000);
}

function notTextError(candidate: string): ActionableError {
  return new ActionableError(
    `File '${candidate}' is not text and not an image format the model can read (PNG, JPEG, GIF or WebP). ` +
      `Decoding it as UTF-8 would send unreadable bytes, not content. Convert it first: a PDF's text layer ` +
      `comes out with 'pdftotext -layout', and a page becomes a readable image with 'pdftoppm -r 150 -png'.`
  );
}

/** Read a UTF-8 file, refusing anything that is not actually text. */
export async function readTextFile(candidate: string): Promise<string> {
  const buffer = await readWithinRoot(candidate);
  if (looksBinary(buffer)) throw notTextError(candidate);
  return buffer.toString('utf8');
}

/**
 * Read one context file as whatever it actually is: an image travels to the
 * model base64-encoded in the `images` field, text goes into the prompt.
 */
export async function readContextFile(candidate: string): Promise<ContextFile> {
  const buffer = await readWithinRoot(candidate);

  const mediaType = imageTypeOf(buffer);
  if (mediaType !== undefined) {
    return { kind: 'image', path: candidate, mediaType, base64: buffer.toString('base64') };
  }

  if (looksBinary(buffer)) throw notTextError(candidate);
  return { kind: 'text', path: candidate, text: buffer.toString('utf8') };
}

export async function writeTextFile(candidate: string, content: string): Promise<void> {
  const path = resolveWithinRoot(candidate);
  await writeFile(path, content, 'utf8');
}

export { ROOT as WORKSPACE_ROOT_RESOLVED };
