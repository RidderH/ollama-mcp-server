/** The general-purpose delegation tool. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DEFAULT_MODEL, DEFAULT_NUM_CTX } from '../constants.js';
import {
  disableThinkingField,
  instructionsField,
  modelField,
  numCtxField,
  responseFormatField,
  temperatureField
} from '../schemas/common.js';
import { readTextFile } from '../services/files.js';
import { stripThinkBlocks } from '../services/format.js';
import { generate } from '../services/ollama.js';
import { reportProgress, respond, respondError, type ToolExtra } from '../services/respond.js';
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

/** Assemble the user prompt from instructions plus any supplied context. */
async function buildPrompt(
  instructions: string,
  contextFiles: string[],
  contextText: string | undefined
): Promise<string> {
  const sections: string[] = [];

  for (const path of contextFiles) {
    const content = await readTextFile(path);
    sections.push(`<file path="${path}">\n${content}\n</file>`);
  }

  if (contextText !== undefined && contextText.trim() !== '') {
    sections.push(`<context>\n${contextText}\n</context>`);
  }

  sections.push(`<task>\n${instructions}\n</task>`);
  return sections.join('\n\n');
}

export function registerDelegateTool(server: McpServer): void {
  server.registerTool(
    'ollama_delegate_task',
    {
      title: 'Delegate a Task to the Local Model',
      description: `Hand a self-contained subtask to a local model running under Ollama and return its answer. Reads files but never writes them.

Intended for offloading bulk or mechanical work — summarising long logs, drafting docstrings, extracting structured data, converting formats, first-pass triage — so the orchestrating agent keeps its own context free. The local model sees only what is passed in this call, so the instructions must be complete on their own.

Args:
  - instructions (string): The complete, self-contained task, 10-20000 characters
  - context_files (string[]): Files to include as context, max 20, paths inside the workspace root (default: [])
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
    "context_files_read": number
  }

Examples:
  - Use when: "summarise what failed in this 4000-line CI log" -> instructions plus context_text
  - Use when: "write numpy-style docstrings for every function in this file, return the full file" -> context_files
  - Use when: "extract every URL from this text as a JSON array" -> instructions plus context_text
  - Don't use when: the task needs the surrounding conversation, spans many files, or is architectural — a small local model has none of that context
  - Don't use when: you want files modified on disk (use ollama_transform_files)

Error Handling:
  - Returns an error naming 'ollama serve' if Ollama is unreachable
  - Returns an error suggesting 'ollama pull <model>' if the model is not installed
  - Returns insufficient=true when the model reports the task was underspecified; rewrite the instructions with more detail
  - Returns an error if a context file is missing, oversized, or outside the workspace root`,
      inputSchema: {
        instructions: instructionsField,
        context_files: z
          .array(z.string().min(1))
          .max(20, 'Pass at most 20 context files')
          .default([])
          .describe('Files to include as context. Paths must resolve inside the workspace root.'),
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
        context_files_read: z.number()
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
        await reportProgress(extra, 0, 2, `Reading ${params.context_files.length} context file(s)`);

        const prompt = await buildPrompt(params.instructions, params.context_files, params.context_text);

        await reportProgress(extra, 1, 2, `Running ${model} locally`);
        const result = await generate({
          model,
          system: DELEGATE_SYSTEM_PROMPT,
          prompt,
          ...(params.num_ctx !== undefined ? { numCtx: params.num_ctx } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          disableThinking: params.disable_thinking
        });

        const text = stripThinkBlocks(result.text);
        const insufficient = /^INSUFFICIENT:/i.test(text.trim());

        const output = {
          output: text,
          model: result.model,
          insufficient,
          ...(result.promptTokens !== undefined ? { prompt_tokens: result.promptTokens } : {}),
          ...(result.outputTokens !== undefined ? { output_tokens: result.outputTokens } : {}),
          ...(result.durationMs !== undefined ? { duration_ms: result.durationMs } : {}),
          context_files_read: params.context_files.length
        };

        await reportProgress(extra, 2, 2, 'Done');

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
