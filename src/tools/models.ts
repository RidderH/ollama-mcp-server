/** Discovery tools: what is installed locally, and what can it handle. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DEFAULT_MODEL, DEFAULT_NUM_CTX } from '../constants.js';
import { responseFormatField } from '../schemas/common.js';
import { formatBytes } from '../services/format.js';
import { contextLengthOf, listModels, showModel } from '../services/ollama.js';
import { respond, respondError } from '../services/respond.js';
import { ResponseFormat } from '../types.js';

const modelSummarySchema = {
  name: z.string(),
  size_bytes: z.number().optional(),
  size_human: z.string(),
  family: z.string().optional(),
  parameter_size: z.string().optional(),
  quantization: z.string().optional(),
  modified_at: z.string().optional()
};

export function registerModelTools(server: McpServer): void {
  server.registerTool(
    'ollama_list_models',
    {
      title: 'List Local Ollama Models',
      description: `List the models currently installed in the local Ollama instance.

Use this before delegating work, so that a model tag is chosen from what is actually installed rather than guessed. It does not download, modify or run anything.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "count": number,               // Number of installed models
    "default_model": string,       // Tag this server uses when none is given
    "models": [
      {
        "name": string,            // Model tag, e.g. "qwen3:8b"
        "size_bytes": number,       // On-disk size (optional)
        "size_human": string,       // e.g. "5.2 GB"
        "family": string,           // e.g. "qwen3" (optional)
        "parameter_size": string,   // e.g. "8.2B" (optional)
        "quantization": string,     // e.g. "Q4_K_M" (optional)
        "modified_at": string       // ISO timestamp (optional)
      }
    ]
  }

Examples:
  - Use when: about to call ollama_delegate_task and the model tag is unknown
  - Use when: a delegation failed with "model not found" and you need the real tag
  - Don't use when: you need the context window of a specific model (use ollama_get_model_info)

Error Handling:
  - Returns an error naming 'ollama serve' if the Ollama API is unreachable
  - Returns count 0 with an empty list if Ollama is running but has no models pulled`,
      inputSchema: { response_format: responseFormatField },
      outputSchema: {
        count: z.number(),
        default_model: z.string(),
        models: z.array(z.object(modelSummarySchema))
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ response_format }) => {
      try {
        const data = await listModels();
        const models = (data.models ?? []).map((model) => ({
          name: model.name,
          ...(model.size !== undefined ? { size_bytes: model.size } : {}),
          size_human: formatBytes(model.size),
          ...(model.details?.family !== undefined ? { family: model.details.family } : {}),
          ...(model.details?.parameter_size !== undefined
            ? { parameter_size: model.details.parameter_size }
            : {}),
          ...(model.details?.quantization_level !== undefined
            ? { quantization: model.details.quantization_level }
            : {}),
          ...(model.modified_at !== undefined ? { modified_at: model.modified_at } : {})
        }));

        const output = { count: models.length, default_model: DEFAULT_MODEL, models };

        const lines =
          models.length === 0
            ? [
                'No models are installed in Ollama.',
                '',
                "Pull one before delegating, for example: `ollama pull qwen3:8b`"
              ]
            : [
                `# Installed Ollama Models (${models.length})`,
                '',
                `Default for this server: \`${DEFAULT_MODEL}\``,
                '',
                ...models.flatMap((model) => [
                  `## ${model.name}`,
                  `- **Size**: ${model.size_human}`,
                  ...(model.parameter_size ? [`- **Parameters**: ${model.parameter_size}`] : []),
                  ...(model.quantization ? [`- **Quantization**: ${model.quantization}`] : []),
                  ...(model.family ? [`- **Family**: ${model.family}`] : []),
                  ''
                ])
              ];

        return respond(output, lines.join('\n'), response_format as ResponseFormat);
      } catch (error) {
        return respondError(error);
      }
    }
  );

  server.registerTool(
    'ollama_get_model_info',
    {
      title: 'Get Ollama Model Details',
      description: `Report the capabilities of one installed Ollama model, most importantly its maximum context length.

Use this to size the 'num_ctx' argument before delegating a large input. Ollama silently truncates prompts that exceed the context window, which looks like the model producing poor output rather than an error, so checking this first is worthwhile whenever the input is big.

Args:
  - model (string): Model tag to inspect, e.g. 'qwen3:8b'
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "model": string,                  // The tag inspected
    "context_length": number,          // Max context in tokens (optional if not advertised)
    "server_default_num_ctx": number,  // What this server sends when num_ctx is omitted
    "family": string,                  // e.g. "qwen3" (optional)
    "parameter_size": string,          // e.g. "8.2B" (optional)
    "quantization": string,            // e.g. "Q4_K_M" (optional)
    "capabilities": string[]           // e.g. ["completion", "tools", "thinking"]
  }

Examples:
  - Use when: about to delegate a 60k-token file and you need to know if it fits
  - Use when: deciding whether a model supports 'tools' or 'thinking'
  - Don't use when: you only need the list of installed models (use ollama_list_models)

Error Handling:
  - Returns an error suggesting 'ollama pull <model>' if the model is not installed
  - Omits context_length if the model does not advertise one`,
      inputSchema: {
        model: z.string().min(1).describe("Model tag to inspect, e.g. 'qwen3:8b'"),
        response_format: responseFormatField
      },
      outputSchema: {
        model: z.string(),
        context_length: z.number().optional(),
        server_default_num_ctx: z.number(),
        family: z.string().optional(),
        parameter_size: z.string().optional(),
        quantization: z.string().optional(),
        capabilities: z.array(z.string())
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ model, response_format }) => {
      try {
        const info = await showModel(model);
        const contextLength = contextLengthOf(info);
        const output = {
          model,
          ...(contextLength !== undefined ? { context_length: contextLength } : {}),
          server_default_num_ctx: DEFAULT_NUM_CTX,
          ...(info.details?.family !== undefined ? { family: info.details.family } : {}),
          ...(info.details?.parameter_size !== undefined
            ? { parameter_size: info.details.parameter_size }
            : {}),
          ...(info.details?.quantization_level !== undefined
            ? { quantization: info.details.quantization_level }
            : {}),
          capabilities: info.capabilities ?? []
        };

        const fitsWarning =
          contextLength !== undefined && DEFAULT_NUM_CTX > contextLength
            ? [
                '',
                `> Warning: this server's default num_ctx (${DEFAULT_NUM_CTX}) exceeds the model's ` +
                  `context length (${contextLength}). Pass an explicit num_ctx at or below ${contextLength}.`
              ]
            : [];

        const lines = [
          `# ${model}`,
          '',
          `- **Context length**: ${contextLength ?? 'not advertised'}`,
          `- **Server default num_ctx**: ${DEFAULT_NUM_CTX}`,
          ...(output.parameter_size ? [`- **Parameters**: ${output.parameter_size}`] : []),
          ...(output.quantization ? [`- **Quantization**: ${output.quantization}`] : []),
          ...(output.family ? [`- **Family**: ${output.family}`] : []),
          `- **Capabilities**: ${output.capabilities.length > 0 ? output.capabilities.join(', ') : 'not reported'}`,
          ...fitsWarning
        ];

        return respond(output, lines.join('\n'), response_format as ResponseFormat);
      } catch (error) {
        return respondError(error);
      }
    }
  );
}
