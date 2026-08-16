#!/usr/bin/env node
/**
 * MCP server for delegating subtasks to a local model running under Ollama.
 *
 * An orchestrating agent keeps the plan and the wider context; this server
 * gives it a way to hand off self-contained, mechanical work to a small model
 * on the same machine and get a structured result back.
 *
 * Transport is stdio, so the server runs as a subprocess of the MCP client.
 * Nothing may be written to stdout except protocol traffic — all logging goes
 * to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  DEFAULT_MODEL,
  DEFAULT_NUM_CTX,
  OLLAMA_HOST,
  SERVER_NAME,
  SERVER_VERSION,
  WORKSPACE_ROOT
} from './constants.js';
import { registerDelegateTool } from './tools/delegate.js';
import { registerModelTools } from './tools/models.js';
import { registerTransformTool } from './tools/transform.js';

function printHelp(): void {
  process.stdout.write(
    `${SERVER_NAME} ${SERVER_VERSION}

An MCP server exposing a local Ollama model as delegation tools over stdio.

Tools:
  ollama_list_models      List installed Ollama models
  ollama_get_model_info   Report a model's context length and capabilities
  ollama_delegate_task    Run a self-contained subtask locally and return the answer
  ollama_transform_files  Apply one instruction across files, writing unified diffs

Environment:
  OLLAMA_HOST                Ollama API base URL (default: http://127.0.0.1:11434)
  OLLAMA_MCP_MODEL           Default model tag (default: qwen3.8:27b-mlx)
  OLLAMA_MCP_NUM_CTX         Default context window (default: 32768)
  OLLAMA_MCP_TIMEOUT_MS      Per-request timeout (default: 600000)
  OLLAMA_MCP_ROOT            Directory file paths are confined to (default: cwd)
  OLLAMA_MCP_MAX_FILE_BYTES  Largest readable file (default: 400000)

Run with no arguments to start the server on stdio.
`
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerModelTools(server);
  registerDelegateTool(server);
  registerTransformTool(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} ready on stdio — ollama=${OLLAMA_HOST} ` +
      `model=${DEFAULT_MODEL} num_ctx=${DEFAULT_NUM_CTX} root=${WORKSPACE_ROOT}`
  );
}

main().catch((error: unknown) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
