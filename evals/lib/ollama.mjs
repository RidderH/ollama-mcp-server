/**
 * Direct /api/chat client for the probes.
 *
 * Deliberately not the MCP server: a probe that went through MCP would measure
 * the client's registration state and its 300 s call cap as much as the model.
 * This mirrors `src/services/ollama.ts` request-for-request so results describe
 * the model the tools actually talk to, and nothing else.
 */

import { cleanFileOutput, stripThinkBlocks } from './clean.mjs';

const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MCP_MODEL ?? 'qwen3.8:27b-mlx';

/** The cap a call through Claude Code's MCP layer dies at, whatever the server allows. */
export const MCP_CALL_CEILING_MS = 300_000;

/**
 * One non-streaming chat completion, with the timings a routing decision needs.
 *
 * The timeout is deliberately far above MCP's 300 s so a slow answer is
 * recorded as slow rather than lost; `exceedsMcpCeiling` marks the ones that
 * would never have survived a real delegation.
 */
export async function generate({
  system,
  prompt,
  model = MODEL,
  numCtx = 32768,
  temperature = 0.2,
  disableThinking = false,
  format,
  images,
  timeoutMs = 900_000
}) {
  const body = {
    model,
    stream: false,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: prompt,
        // Base64 images ride in Ollama's own `images` field and cost image
        // tokens rather than text tokens, exactly as `generate()` in
        // `src/services/ollama.ts` sends them.
        ...(images !== undefined && images.length > 0 ? { images } : {})
      }
    ],
    options: { num_ctx: numCtx, temperature }
  };
  if (disableThinking) body.think = false;
  // Ollama's own structured-output field, which the MCP server does NOT send
  // (`src/services/ollama.ts` builds model/messages/options/think and nothing
  // else). It is here so a probe can measure what adding it would buy, which
  // is a decision about the server rather than about a prompt.
  if (format !== undefined) body.format = format;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${raw.slice(0, 300)}`, wallMs: Date.now() - startedAt };
    }

    const parsed = JSON.parse(raw);
    const text = parsed.message?.content ?? '';
    const wallMs = Date.now() - startedAt;

    return {
      ok: true,
      text,
      // `file` is what ollama_transform_files would write; `text` is what
      // ollama_delegate_task returns. Probes grade whichever their tool uses.
      cleanedFile: cleanFileOutput(text),
      cleanedText: stripThinkBlocks(text),
      model: parsed.model ?? model,
      // Present only when the model ran a thinking phase. Recorded because
      // `format` and thinking interact, and the interaction is silent.
      thought: parsed.message?.thinking !== undefined,
      promptTokens: parsed.prompt_eval_count,
      outputTokens: parsed.eval_count,
      wallMs,
      exceedsMcpCeiling: wallMs > MCP_CALL_CEILING_MS
    };
  } catch (error) {
    const wallMs = Date.now() - startedAt;
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? `aborted by the probe after ${Math.round(wallMs / 1000)}s` : String(error),
      wallMs,
      exceedsMcpCeiling: wallMs > MCP_CALL_CEILING_MS
    };
  } finally {
    clearTimeout(timer);
  }
}

export { MODEL as DEFAULT_MODEL, HOST as OLLAMA_HOST };
