/** The general-purpose delegation tool. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DEFAULT_MODEL, DEFAULT_NUM_CTX, HEARTBEAT_MS } from '../constants.js';
import {
  disableThinkingField,
  instructionsField,
  modelField,
  numCtxField,
  responseFormatField,
  temperatureField
} from '../schemas/common.js';
import { readContextFile } from '../services/files.js';
import { stripThinkBlocks } from '../services/format.js';
import { assertVisionCapable, generate } from '../services/ollama.js';
import { progressCounter, respond, respondError, type ToolExtra } from '../services/respond.js';
import { ResponseFormat } from '../types.js';

const DELEGATE_SYSTEM_PROMPT = [
  'You are a local worker model completing a self-contained subtask handed to you by another agent.',
  '',
  'Rules:',
  '- Do exactly what the instructions ask. Do not expand the scope.',
  '- Return only the requested output. No preamble, no sign-off, no restating the task.',
  '- If the instructions are ambiguous or the context is insufficient, say so in one sentence',
  '  beginning with "INSUFFICIENT:" and stop. Do not guess.'
].join('\n');

/**
 * Assemble the user prompt from instructions plus any supplied context.
 *
 * Text files are inlined; images are collected for the `images` field and left
 * out of the prompt, which only names them so the instructions can refer to
 * one image among several.
 */
async function buildPrompt(
  instructions: string,
  contextFiles: string[],
  contextText: string | undefined
): Promise<{ prompt: string; images: string[] }> {
  const sections: string[] = [];
  const images: string[] = [];

  for (const path of contextFiles) {
    const file = await readContextFile(path);
    if (file.kind === 'image') {
      images.push(file.base64);
      sections.push(`<image path="${path}" type="${file.mediaType}" index="${images.length}" />`);
      continue;
    }
    sections.push(`<file path="${path}">\n${file.text}\n</file>`);
  }

  if (contextText !== undefined && contextText.trim() !== '') {
    sections.push(`<context>\n${contextText}\n</context>`);
  }

  sections.push(`<task>\n${instructions}\n</task>`);
  return { prompt: sections.join('\n\n'), images };
}

export function registerDelegateTool(server: McpServer): void {
  server.registerTool(
    'ollama_delegate_task',
    {
      title: 'Delegate a Task to the Local Model',
      description: `Hand a self-contained subtask to a local model running under Ollama and return its answer. Reads files but never writes them.

Intended for offloading bulk or mechanical work — summarising long logs, drafting docstrings, extracting structured data, converting formats, first-pass triage — so the orchestrating agent keeps its own context free. The local model sees only what is passed in this call, so the instructions must be complete on their own.

A context file that is a PNG, JPEG, GIF or WebP is sent as an image to a vision model, not as prompt text. Any other non-text file is refused rather than decoded into unreadable bytes.

Args:
  - instructions (string): The complete, self-contained task, 10-20000 characters
  - context_files (string[]): Files to include as context, max 20, paths inside the workspace root; images go to the model as images (default: [])
  - context_text (string): Inline text to include, e.g. log output (optional)
  - model (string): Ollama model tag (default: server default, currently '${DEFAULT_MODEL}')
  - num_ctx (number): Context window in tokens (default: ${DEFAULT_NUM_CTX})
  - temperature (number): Sampling temperature, 0-2 (default: 0.2)
  - disable_thinking (boolean): Skip the model's reasoning phase for speed (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "output": string,           // The model's answer, reasoning blocks stripped
    "model": string,            // Model that actually ran
    "insufficient": boolean,    // True if the model reported it lacked information
    "prompt_tokens": number,    // Input tokens consumed (optional)
    "output_tokens": number,    // Tokens generated (optional)
    "duration_ms": number,      // Wall-clock generation time (optional)
    "context_files_read": number,
    "images_sent": number      // How many of those files travelled as images
  }

Examples:
  - Use when: "summarise what failed in this 4000-line CI log" -> instructions plus context_text
  - Use when: "write numpy-style docstrings for every function in this file, return the full file" -> context_files
  - Use when: "extract every URL from this text as a JSON array" -> instructions plus context_text
  - Use when: "read the table in this screenshot as JSON" -> a PNG or JPEG in context_files, with a vision model
  - Don't use when: the task needs the surrounding conversation, spans many files, or is architectural — a small local model has none of that context
  - Don't use when: you want files modified on disk (use ollama_transform_files)

Error Handling:
  - Returns an error naming 'ollama serve' if Ollama is unreachable
  - Returns an error suggesting 'ollama pull <model>' if the model is not installed
  - Returns insufficient=true when the model reports the task was underspecified; rewrite the instructions with more detail
  - Returns an error if a context file is missing, oversized, or outside the workspace root
  - Returns an error naming 'vision' if images are passed to a model that cannot see them
  - Returns an error if a context file is neither text nor a readable image format`,
      inputSchema: {
        instructions: instructionsField,
        context_files: z
          .array(z.string().min(1))
          .max(20, 'Pass at most 20 context files')
          .default([])
          .describe('Files to include as context. Paths must resolve inside the workspace root. PNG, JPEG, GIF and WebP files are sent as images to a vision model; other binaries are refused.'),
        context_text: z
          .string()
          .max(500_000)
          .optional()
          .describe('Inline text to include as context, such as captured log or command output.'),
        model: modelField,
        num_ctx: numCtxField,
        temperature: temperatureField,
        disable_thinking: disableThinkingField,
        response_format: responseFormatField
      },
      outputSchema: {
        output: z.string(),
        model: z.string(),
        insufficient: z.boolean(),
        prompt_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        duration_ms: z.number().optional(),
        context_files_read: z.number(),
        images_sent: z.number()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params, extra: ToolExtra) => {
      try {
        const model = params.model ?? DEFAULT_MODEL;
        const progress = progressCounter(extra, HEARTBEAT_MS);
        await progress.step(`Reading ${params.context_files.length} context file(s)`);

        const { prompt, images } = await buildPrompt(
          params.instructions,
          params.context_files,
          params.context_text
        );

        if (images.length > 0) {
          await progress.step(`Checking ${model} can read images`);
          await assertVisionCapable(model, images.length);
        }

        await progress.step(`Running ${model} locally`);
        const stopHeartbeat = progress.heartbeat(`Generating with ${model}`);
        let result;
        try {
          result = await generate({
            model,
            system: DELEGATE_SYSTEM_PROMPT,
            prompt,
            ...(images.length > 0 ? { images } : {}),
            ...(params.num_ctx !== undefined ? { numCtx: params.num_ctx } : {}),
            ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
            disableThinking: params.disable_thinking
          });
        } finally {
          stopHeartbeat();
        }

        const text = stripThinkBlocks(result.text);
        const insufficient = /^INSUFFICIENT:/i.test(text.trim());

        const output = {
          output: text,
          model: result.model,
          insufficient,
          ...(result.promptTokens !== undefined ? { prompt_tokens: result.promptTokens } : {}),
          ...(result.outputTokens !== undefined ? { output_tokens: result.outputTokens } : {}),
          ...(result.durationMs !== undefined ? { duration_ms: result.durationMs } : {}),
          context_files_read: params.context_files.length,
          images_sent: images.length
        };

        await progress.step('Done');

        const header = insufficient
          ? [
              `> The local model reported insufficient information. Rewrite the instructions with more`,
              `> detail or supply the missing context, then call again.`,
              ''
            ]
          : [];

        const stats = [
          `_${result.model}`,
          result.durationMs !== undefined ? `, ${(result.durationMs / 1000).toFixed(1)}s` : '',
          result.outputTokens !== undefined ? `, ${result.outputTokens} tokens out` : '',
          '_'
        ].join('');

        return respond(output, [...header, text, '', stats].join('\n'), params.response_format as ResponseFormat);
      } catch (error) {
        return respondError(error);
      }
    }
  );
}
