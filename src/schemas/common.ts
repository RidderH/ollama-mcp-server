/** Zod fields shared by more than one tool. */

import { z } from 'zod';

import { DEFAULT_MODEL, DEFAULT_TEMPERATURE } from '../constants.js';
import { ResponseFormat } from '../types.js';

export const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const modelField = z
  .string()
  .min(1)
  .optional()
  .describe(
    `Ollama model tag to run, e.g. 'qwen3:8b'. Defaults to ${DEFAULT_MODEL}. ` +
      `Call ollama_list_models to see what is installed.`
  );

export const numCtxField = z
  .number()
  .int()
  .min(512)
  .max(1_048_576)
  .optional()
  .describe(
    'Context window in tokens for this call. Defaults to OLLAMA_MCP_NUM_CTX (32768). Raise it for large ' +
      'inputs, but keep it under the model context length reported by ollama_get_model_info.'
  );

export const temperatureField = z
  .number()
  .min(0)
  .max(2)
  .optional()
  .describe(`Sampling temperature. Defaults to ${DEFAULT_TEMPERATURE}; keep it low for mechanical work.`);

export const disableThinkingField = z
  .boolean()
  .default(false)
  .describe(
    'Ask the model to skip its reasoning phase. Cuts latency substantially on thinking models such as ' +
      'Qwen3 for mechanical tasks. Ignored by models without a thinking mode.'
  );

export const instructionsField = z
  .string()
  .min(10, 'Instructions must be at least 10 characters')
  .max(20_000, 'Instructions must not exceed 20000 characters')
  .describe(
    'What the local model should do. Be explicit and self-contained: a small local model has none of the ' +
      'surrounding conversation, so state the goal, the constraints and the exact output you expect.'
  );
