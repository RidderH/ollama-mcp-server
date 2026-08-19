/** HTTP client for the Ollama API. */

import { DEFAULT_NUM_CTX, DEFAULT_TEMPERATURE, OLLAMA_HOST, REQUEST_TIMEOUT_MS } from '../constants.js';
import {
  ActionableError,
  type GenerationResult,
  type OllamaChatResponse,
  type OllamaShowResponse,
  type OllamaTagsResponse
} from '../types.js';

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Perform one Ollama API request, mapping transport and API failures onto
 * messages that tell the caller what to do about them.
 */
async function ollamaRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_HOST}${path}`, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ActionableError(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s. Local generation is slow — ` +
          `split the work into smaller pieces, or raise OLLAMA_MCP_TIMEOUT_MS.`
      );
    }
    throw new ActionableError(
      `Cannot reach Ollama at ${OLLAMA_HOST}. Check that it is running ('ollama serve') and that ` +
        `OLLAMA_HOST points at it. Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();

  if (!response.ok) {
    const detail = extractApiError(raw);
    if (response.status === 404) {
      throw new ActionableError(
        `Ollama returned 404: ${detail}. If this names a model, pull it first with ` +
          `'ollama pull <model>', or call ollama_list_models to see what is installed.`
      );
    }
    throw new ActionableError(`Ollama request to ${path} failed with status ${response.status}: ${detail}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ActionableError(`Ollama returned a response that is not valid JSON: ${raw.slice(0, 200)}`);
  }
}

/** Pull the `error` field out of an Ollama error body, falling back to raw text. */
function extractApiError(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const message = (parsed as { error: unknown }).error;
      if (typeof message === 'string') return message;
    }
  } catch {
    /* fall through to the raw body */
  }
  return raw.slice(0, 300) || '(empty response body)';
}

export async function listModels(): Promise<OllamaTagsResponse> {
  return ollamaRequest<OllamaTagsResponse>('/api/tags', { timeoutMs: 15_000 });
}

export async function showModel(model: string): Promise<OllamaShowResponse> {
  return ollamaRequest<OllamaShowResponse>('/api/show', {
    method: 'POST',
    body: { model },
    timeoutMs: 30_000
  });
}

export interface GenerateParams {
  model: string;
  system: string;
  prompt: string;
  images?: string[];
  numCtx?: number;
  temperature?: number;
  disableThinking?: boolean;
}

/**
 * Run one non-streaming chat completion.
 *
 * `think: false` is only understood by newer Ollama builds and only by models
 * with a thinking mode, so a rejection of that field is retried without it
 * rather than surfaced as a failure.
 */
export async function generate(params: GenerateParams): Promise<GenerationResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    stream: false,
    messages: [
      { role: 'system', content: params.system },
      {
        role: 'user',
        content: params.prompt,
        ...(params.images !== undefined && params.images.length > 0 ? { images: params.images } : {})
      }
    ],
    options: {
      num_ctx: params.numCtx ?? DEFAULT_NUM_CTX,
      temperature: params.temperature ?? DEFAULT_TEMPERATURE
    }
  };

  if (params.disableThinking) {
    body['think'] = false;
  }

  let response: OllamaChatResponse;
  try {
    response = await ollamaRequest<OllamaChatResponse>('/api/chat', { method: 'POST', body });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const thinkUnsupported =
      params.disableThinking && /think|does not support/i.test(message);
    if (!thinkUnsupported) throw error;

    delete body['think'];
    response = await ollamaRequest<OllamaChatResponse>('/api/chat', { method: 'POST', body });
  }

  const text = response.message?.content ?? '';
  if (text.trim() === '') {
    throw new ActionableError(
      `Model '${params.model}' returned an empty response. This usually means the prompt exceeded the ` +
        `context window and was truncated — retry with a smaller input or a larger num_ctx.`
    );
  }

  return {
    text,
    model: response.model ?? params.model,
    promptTokens: response.prompt_eval_count,
    outputTokens: response.eval_count,
    durationMs: response.total_duration !== undefined ? Math.round(response.total_duration / 1e6) : undefined
  };
}

/**
 * Refuse to send images to a model that cannot see them.
 *
 * Ollama accepts the `images` field whatever the model is; one without vision
 * simply ignores it and answers from the prompt text alone, which reads as a
 * confident answer about an image it never saw. A model that advertises no
 * capabilities at all is left alone — absence of the field is not a denial.
 */
export async function assertVisionCapable(model: string, imageCount: number): Promise<void> {
  const info = await showModel(model);
  const capabilities = info.capabilities;
  if (capabilities === undefined || capabilities.includes('vision')) return;

  throw new ActionableError(
    `Model '${model}' has no vision capability, so the ${imageCount} image file(s) passed would be ignored ` +
      `and answered from the surrounding text alone. Run ollama_list_models and pick a model whose ` +
      `capabilities include 'vision', or pass the content as text instead.`
  );
}

/** Read the advertised context length out of an /api/show payload, if present. */
export function contextLengthOf(info: OllamaShowResponse): number | undefined {
  const modelInfo = info.model_info;
  if (!modelInfo) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}
