/** Bulk file rewriting delegated to the local model. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';

import {
  DEFAULT_MODEL,
  DEFAULT_NUM_CTX,
  MAX_TRANSFORM_FILES,
  MIN_OUTPUT_RATIO,
  SHRINK_CHECK_MIN_BYTES
} from '../constants.js';
import {
  disableThinkingField,
  instructionsField,
  modelField,
  numCtxField,
  responseFormatField,
  temperatureField
} from '../schemas/common.js';
import { readTextFile, writeTextFile } from '../services/files.js';
import { cleanFileOutput } from '../services/format.js';
import { generate } from '../services/ollama.js';
import { reportProgress, respond, respondError, type ToolExtra } from '../services/respond.js';
import { ResponseFormat, type TransformOutcome } from '../types.js';

const TRANSFORM_SYSTEM_PROMPT = [
  'You rewrite source files. You are given one file and an instruction.',
  '',
  'Rules:',
  '- Output the COMPLETE new contents of the file, from the first line to the last.',
  '- Output nothing else: no markdown fences, no explanation, no commentary.',
  '- Preserve everything the instruction does not ask you to change, byte for byte.',
  '- Never truncate, never abbreviate, never write a placeholder such as "rest of file unchanged".',
  '- If you cannot carry out the instruction, output exactly: CANNOT_COMPLY'
].join('\n');

interface TransformSettings {
  model: string;
  numCtx: number | undefined;
  temperature: number | undefined;
  disableThinking: boolean;
  dryRun: boolean;
}

/**
 * Rewrite one file, refusing to persist output that looks like a failed
 * generation rather than a real edit.
 */
async function transformOne(
  path: string,
  instructions: string,
  settings: TransformSettings
): Promise<TransformOutcome> {
  const before = await readTextFile(path);

  const result = await generate({
    model: settings.model,
    system: TRANSFORM_SYSTEM_PROMPT,
    prompt: `<instruction>\n${instructions}\n</instruction>\n\n<file path="${path}">\n${before}\n</file>`,
    ...(settings.numCtx !== undefined ? { numCtx: settings.numCtx } : {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    disableThinking: settings.disableThinking
  });

  const after = cleanFileOutput(result.text);

  if (after.trim() === 'CANNOT_COMPLY') {
    return { path, status: 'failed', error: 'The model reported it could not carry out the instruction.' };
  }

  if (after.trim() === '') {
    return { path, status: 'failed', error: 'The model returned empty output; the file was left unchanged.' };
  }

  // A drastically shorter result is nearly always a truncated generation, not a
  // legitimate edit. Writing it would destroy the file, so refuse instead.
  if (before.length >= SHRINK_CHECK_MIN_BYTES && after.length < before.length * MIN_OUTPUT_RATIO) {
    return {
      path,
      status: 'failed',
      bytes_before: before.length,
      bytes_after: after.length,
      error:
        `Output was ${after.length} bytes against an original of ${before.length}, below the ` +
        `${Math.round(MIN_OUTPUT_RATIO * 100)}% floor, so it was discarded as a likely truncated ` +
        `generation. The file is untouched. Retry with a larger num_ctx, or split the file.`
    };
  }

  if (after === before) {
    return { path, status: 'unchanged', bytes_before: before.length, bytes_after: after.length };
  }

  const diff = createTwoFilesPatch(path, path, before, after, '', '', { context: 3 });

  if (!settings.dryRun) {
    await writeTextFile(path, after);
  }

  return {
    path,
    status: settings.dryRun ? 'skipped' : 'changed',
    diff,
    bytes_before: before.length,
    bytes_after: after.length
  };
}

export function registerTransformTool(server: McpServer): void {
  server.registerTool(
    'ollama_transform_files',
    {
      title: 'Rewrite Files with the Local Model',
      description: `Apply one instruction to each of several files using a local Ollama model, writing the results to disk and returning a unified diff per file.

Each file is processed independently in its own request, so the instruction must make sense file by file. Intended for repetitive edits that do not need cross-file reasoning: adding docstrings, renaming a symbol, converting comment style, adding type annotations, updating a licence header.

Files are written in place. Review the returned diffs, and prefer running with dry_run=true first on an unfamiliar codebase. Output that comes back drastically shorter than the original is discarded rather than written, since that indicates a truncated generation.

Args:
  - paths (string[]): Files to rewrite, 1-${MAX_TRANSFORM_FILES}, inside the workspace root
  - instructions (string): The edit to apply to every file, 10-20000 characters
  - dry_run (boolean): Compute diffs without writing to disk (default: false)
  - model (string): Ollama model tag (default: server default, currently '${DEFAULT_MODEL}')
  - num_ctx (number): Context window in tokens (default: ${DEFAULT_NUM_CTX})
  - temperature (number): Sampling temperature, 0-2 (default: 0.2)
  - disable_thinking (boolean): Skip the model's reasoning phase for speed (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "model": string,           // Model that ran
    "dry_run": boolean,
    "changed": number,         // Files written (or that would be, when dry_run)
    "unchanged": number,       // Files the model returned identical
    "failed": number,          // Files that errored or were rejected by the safety check
    "results": [
      {
        "path": string,
        "status": "changed" | "unchanged" | "skipped" | "failed",
        "diff": string,         // Unified diff, present when content changed
        "error": string,        // Present when status is "failed"
        "bytes_before": number,
        "bytes_after": number
      }
    ]
  }

Examples:
  - Use when: "add JSDoc to every exported function in these 8 files" -> paths plus instructions
  - Use when: "convert these test files from assert to expect" -> paths plus instructions
  - Use when: previewing a risky bulk edit -> same call with dry_run=true
  - Don't use when: the edit needs consistency across files, such as renaming a symbol and updating its imports
  - Don't use when: you only want an answer rather than a file change (use ollama_delegate_task)

Error Handling:
  - Per-file failures are reported in 'results' with status "failed"; other files still process
  - status "failed" always means the file was left untouched
  - Returns an error if Ollama is unreachable or the model is not installed
  - Returns an error if a path is missing, oversized, or outside the workspace root`,
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1, 'Pass at least one file')
          .max(MAX_TRANSFORM_FILES, `Pass at most ${MAX_TRANSFORM_FILES} files`)
          .describe('Files to rewrite. Paths must resolve inside the workspace root.'),
        instructions: instructionsField,
        dry_run: z
          .boolean()
          .default(false)
          .describe('Compute and return diffs without writing anything to disk.'),
        model: modelField,
        num_ctx: numCtxField,
        temperature: temperatureField,
        disable_thinking: disableThinkingField,
        response_format: responseFormatField
      },
      outputSchema: {
        model: z.string(),
        dry_run: z.boolean(),
        changed: z.number(),
        unchanged: z.number(),
        failed: z.number(),
        results: z.array(
          z.object({
            path: z.string(),
            status: z.enum(['changed', 'unchanged', 'skipped', 'failed']),
            diff: z.string().optional(),
            error: z.string().optional(),
            bytes_before: z.number().optional(),
            bytes_after: z.number().optional()
          })
        )
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params, extra: ToolExtra) => {
      try {
        const settings: TransformSettings = {
          model: params.model ?? DEFAULT_MODEL,
          numCtx: params.num_ctx,
          temperature: params.temperature,
          disableThinking: params.disable_thinking,
          dryRun: params.dry_run
        };

        const results: TransformOutcome[] = [];
        const total = params.paths.length;

        for (const [index, path] of params.paths.entries()) {
          await reportProgress(extra, index, total, `Rewriting ${path} (${index + 1}/${total})`);
          try {
            results.push(await transformOne(path, params.instructions, settings));
          } catch (error) {
            // One bad file must not abandon the rest of the batch.
            results.push({
              path,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        await reportProgress(extra, total, total, 'Done');

        const counts = {
          changed: results.filter((r) => r.status === 'changed' || r.status === 'skipped').length,
          unchanged: results.filter((r) => r.status === 'unchanged').length,
          failed: results.filter((r) => r.status === 'failed').length
        };

        const output = { model: settings.model, dry_run: settings.dryRun, ...counts, results };

        const verb = settings.dryRun ? 'would change' : 'changed';
        const lines = [
          `# Local rewrite of ${total} file(s) with ${settings.model}`,
          '',
          `${counts.changed} ${verb}, ${counts.unchanged} unchanged, ${counts.failed} failed` +
            (settings.dryRun ? ' — dry run, nothing was written.' : ''),
          '',
          ...results.flatMap((result) => {
            if (result.status === 'failed') {
              return [`## ${result.path} — FAILED (file untouched)`, result.error ?? '', ''];
            }
            if (result.status === 'unchanged') {
              return [`## ${result.path} — unchanged`, ''];
            }
            return [
              `## ${result.path} — ${settings.dryRun ? 'would change' : 'changed'}`,
              '```diff',
              result.diff ?? '',
              '```',
              ''
            ];
          })
        ];

        return respond(output, lines.join('\n'), params.response_format as ResponseFormat);
      } catch (error) {
        return respondError(error);
      }
    }
  );
}
