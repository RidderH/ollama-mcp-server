/** Shared type definitions for the Ollama API and tool responses. */

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

export interface OllamaModelDetails {
  family?: string;
  families?: string[] | null;
  format?: string;
  parameter_size?: string;
  quantization_level?: string;
}

export interface OllamaTagsModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
}

export interface OllamaTagsResponse {
  models?: OllamaTagsModel[];
}

export interface OllamaShowResponse {
  details?: OllamaModelDetails;
  model_info?: Record<string, unknown>;
  capabilities?: string[];
  parameters?: string;
  template?: string;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export interface OllamaChatResponse {
  model?: string;
  message?: OllamaChatMessage;
  done?: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Normalised result of one generation, independent of the endpoint used. */
export interface GenerationResult {
  text: string;
  model: string;
  promptTokens: number | undefined;
  outputTokens: number | undefined;
  durationMs: number | undefined;
}

/** Outcome of attempting to rewrite one file. */
export type TransformStatus = 'changed' | 'unchanged' | 'skipped' | 'failed';

export interface TransformOutcome {
  path: string;
  status: TransformStatus;
  diff?: string;
  error?: string;
  bytes_before?: number;
  bytes_after?: number;
}

/**
 * Raised for conditions the calling agent can act on: Ollama not running, a
 * model that is not pulled, a path outside the workspace. The message is
 * written to be read by an agent, so it names the fix.
 */
export class ActionableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionableError';
  }
}
