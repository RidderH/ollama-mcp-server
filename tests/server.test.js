/**
 * End-to-end tests: a real MCP client drives the server over stdio, while a
 * stub HTTP server stands in for Ollama so the behaviour under test is the
 * server's own logic rather than a model's output.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** Next chat reply the stub will hand back; tests set this per case. */
let nextChatContent = 'stub reply';
let lastChatBody = null;
/** Delay before the stub answers /api/chat, to simulate slow local generation. */
let nextChatDelayMs = 0;
/** Capabilities the stub reports for /api/show; tests flip vision on and off. */
let showCapabilities = ['completion', 'tools', 'thinking'];

/** A real 1x1 transparent PNG, so the magic-byte sniff is exercised for real. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function startStubOllama() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/api/tags') {
        res.end(
          JSON.stringify({
            models: [
              {
                name: 'qwen3:8b',
                size: 5_200_000_000,
                modified_at: '2026-01-01T00:00:00Z',
                details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M' }
              }
            ]
          })
        );
        return;
      }

      if (req.url === '/api/show') {
        res.end(
          JSON.stringify({
            details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M' },
            model_info: { 'qwen3.context_length': 40960 },
            capabilities: showCapabilities
          })
        );
        return;
      }

      if (req.url === '/api/chat') {
        lastChatBody = JSON.parse(body);
        const reply = JSON.stringify({
          model: lastChatBody.model,
          message: { role: 'assistant', content: nextChatContent },
          done: true,
          total_duration: 1_500_000_000,
          prompt_eval_count: 120,
          eval_count: 45
        });
        setTimeout(() => res.end(reply), nextChatDelayMs);
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: `unknown endpoint ${req.url}` }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('ollama-mcp-server', () => {
  let stub;
  let client;
  let workspace;

  before(async () => {
    stub = await startStubOllama();
    workspace = await mkdtemp(join(tmpdir(), 'ollama-mcp-test-'));

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_ENTRY],
        env: {
          PATH: process.env.PATH,
          OLLAMA_HOST: `http://127.0.0.1:${stub.address().port}`,
          OLLAMA_MCP_ROOT: workspace,
          OLLAMA_MCP_MODEL: 'qwen3:8b'
        }
      })
    );
  });

  after(async () => {
    await client?.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  it('ships delegation instructions to the client at initialize', () => {
    const instructions = client.getInstructions();
    assert.ok(instructions, 'server should declare instructions in its initialize result');
    assert.match(instructions, /ollama_delegate_task/);
  });

  it('sends heartbeat progress while a slow generation is running', async () => {
    const slow = new Client({ name: 'test-client-slow', version: '1.0.0' });
    await slow.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_ENTRY],
        env: {
          PATH: process.env.PATH,
          OLLAMA_HOST: `http://127.0.0.1:${stub.address().port}`,
          OLLAMA_MCP_ROOT: workspace,
          OLLAMA_MCP_MODEL: 'qwen3:8b',
          OLLAMA_MCP_HEARTBEAT_MS: '200'
        }
      })
    );

    nextChatContent = 'slow but steady';
    nextChatDelayMs = 1200;
    const updates = [];
    try {
      const result = await slow.callTool(
        { name: 'ollama_delegate_task', arguments: { instructions: 'Count to three, slowly.' } },
        undefined,
        { onprogress: (update) => updates.push(update) }
      );
      assert.equal(result.structuredContent.output, 'slow but steady');
    } finally {
      nextChatDelayMs = 0;
      await slow.close();
    }

    const heartbeats = updates.filter((u) => /still running|elapsed/i.test(u.message ?? ''));
    assert.ok(
      heartbeats.length >= 2,
      `expected at least 2 heartbeat notifications during a 1.2s generation, got ${heartbeats.length} ` +
        `(all updates: ${JSON.stringify(updates)})`
    );
    const progressValues = updates.map((u) => u.progress);
    const sorted = [...progressValues].sort((a, b) => a - b);
    assert.deepEqual(progressValues, sorted, 'progress must be monotonically non-decreasing');
  });

  it('advertises all four tools with correct annotations', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'ollama_delegate_task',
      'ollama_get_model_info',
      'ollama_list_models',
      'ollama_transform_files'
    ]);

    const transform = tools.find((t) => t.name === 'ollama_transform_files');
    assert.equal(transform.annotations.destructiveHint, true);
    assert.equal(transform.annotations.readOnlyHint, false);
    assert.ok(transform.outputSchema, 'transform tool should declare an output schema');

    const list = tools.find((t) => t.name === 'ollama_list_models');
    assert.equal(list.annotations.readOnlyHint, true);
  });

  it('lists models from Ollama', async () => {
    const result = await client.callTool({ name: 'ollama_list_models', arguments: {} });
    assert.equal(result.structuredContent.count, 1);
    assert.equal(result.structuredContent.models[0].name, 'qwen3:8b');
    assert.equal(result.structuredContent.models[0].size_human, '4.8 GB');
  });

  it('reports model context length', async () => {
    const result = await client.callTool({
      name: 'ollama_get_model_info',
      arguments: { model: 'qwen3:8b' }
    });
    assert.equal(result.structuredContent.context_length, 40960);
    assert.deepEqual(result.structuredContent.capabilities, ['completion', 'tools', 'thinking']);
  });

  it('sends an explicit num_ctx on every generation', async () => {
    nextChatContent = 'anything';
    await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'Say something useful please.' }
    });
    assert.equal(lastChatBody.options.num_ctx, 32768);
    assert.equal(lastChatBody.stream, false);
  });

  it('strips think blocks from delegated output', async () => {
    nextChatContent = '<think>let me consider this carefully</think>\nThe answer is 42.';
    const result = await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'What is the answer to everything?' }
    });
    assert.equal(result.structuredContent.output, 'The answer is 42.');
    assert.equal(result.structuredContent.insufficient, false);
    assert.equal(result.structuredContent.output_tokens, 45);
  });

  it('flags an underspecified task instead of guessing', async () => {
    nextChatContent = 'INSUFFICIENT: no file was provided to work from.';
    const result = await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'Refactor the thing we discussed.' }
    });
    assert.equal(result.structuredContent.insufficient, true);
  });

  it('rewrites a file and reports a diff', async () => {
    const target = join(workspace, 'greet.js');
    await writeFile(target, 'export function greet(name) {\n  return `Hello ${name}`;\n}\n');

    nextChatContent =
      '```javascript\n/** Greet someone by name. */\nexport function greet(name) {\n  return `Hello ${name}`;\n}\n```';

    const result = await client.callTool({
      name: 'ollama_transform_files',
      arguments: { paths: ['greet.js'], instructions: 'Add a JSDoc comment to the exported function.' }
    });

    assert.equal(result.structuredContent.changed, 1);
    assert.equal(result.structuredContent.failed, 0);
    assert.equal(result.structuredContent.results[0].status, 'changed');
    assert.match(result.structuredContent.results[0].diff, /\+\/\*\* Greet someone by name\. \*\//);

    const written = await readFile(target, 'utf8');
    assert.ok(written.startsWith('/** Greet someone by name. */'), 'fences should be stripped before writing');
    assert.ok(!written.includes('```'), 'no code fence should reach disk');
  });

  it('does not write to disk on a dry run', async () => {
    const target = join(workspace, 'untouched.js');
    const original = 'export const value = 1;\n';
    await writeFile(target, original);

    nextChatContent = 'export const value = 2;\n';
    const result = await client.callTool({
      name: 'ollama_transform_files',
      arguments: { paths: ['untouched.js'], instructions: 'Change the value to 2.', dry_run: true }
    });

    assert.equal(result.structuredContent.results[0].status, 'skipped');
    assert.ok(result.structuredContent.results[0].diff);
    assert.equal(await readFile(target, 'utf8'), original, 'dry run must leave the file alone');
  });

  it('discards a truncated generation rather than destroying the file', async () => {
    const target = join(workspace, 'long.js');
    const original = `// a file with real content\n${'export const x = 1;\n'.repeat(40)}`;
    await writeFile(target, original);

    nextChatContent = 'export const x = 1;\n// rest of file unchanged';
    const result = await client.callTool({
      name: 'ollama_transform_files',
      arguments: { paths: ['long.js'], instructions: 'Add a trailing newline to the file.' }
    });

    assert.equal(result.structuredContent.failed, 1);
    assert.equal(result.structuredContent.results[0].status, 'failed');
    assert.match(result.structuredContent.results[0].error, /truncated generation/);
    assert.equal(await readFile(target, 'utf8'), original, 'a rejected rewrite must leave the file intact');
  });

  it('refuses paths outside the workspace root', async () => {
    const result = await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'Summarise this file for me.', context_files: ['../../../etc/passwd'] }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /outside the workspace root/);
  });

  it('keeps processing a batch when one file fails', async () => {
    await writeFile(join(workspace, 'ok.js'), 'export const a = 1;\n');
    nextChatContent = 'export const a = 2;\n';

    const result = await client.callTool({
      name: 'ollama_transform_files',
      arguments: { paths: ['missing.js', 'ok.js'], instructions: 'Bump the constant by one.' }
    });

    assert.equal(result.structuredContent.failed, 1);
    assert.equal(result.structuredContent.changed, 1);
    assert.match(result.structuredContent.results[0].error, /File not found/);
    assert.equal(result.structuredContent.results[1].status, 'changed');
  });

  it('sends an image context file as base64 images, never as prompt text', async () => {
    showCapabilities = ['completion', 'vision', 'tools', 'thinking'];
    await writeFile(join(workspace, 'shot.png'), Buffer.from(PNG_1X1, 'base64'));
    nextChatContent = 'A one-pixel transparent square.';

    try {
      const result = await client.callTool({
        name: 'ollama_delegate_task',
        arguments: { instructions: 'Describe this image in one sentence.', context_files: ['shot.png'] }
      });

      const user = lastChatBody.messages.find((message) => message.role === 'user');
      assert.deepEqual(user.images, [PNG_1X1], 'the image belongs in the images field');
      assert.ok(!user.content.includes(PNG_1X1), 'image bytes must not reach the text prompt');
      assert.match(user.content, /shot\.png/, 'the prompt still names the file');
      assert.equal(result.structuredContent.images_sent, 1);
    } finally {
      showCapabilities = ['completion', 'tools', 'thinking'];
    }
  });

  it('refuses an image when the model cannot see', async () => {
    showCapabilities = ['completion', 'tools', 'thinking'];
    await writeFile(join(workspace, 'blind.png'), Buffer.from(PNG_1X1, 'base64'));

    const result = await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'Read the table in this image.', context_files: ['blind.png'] }
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /vision/i);
  });

  it('refuses a binary context file rather than passing mojibake off as text', async () => {
    await writeFile(join(workspace, 'scan.pdf'), Buffer.from('%PDF-1.4\n\u0000\u0001\u0002stream', 'binary'));

    const result = await client.callTool({
      name: 'ollama_delegate_task',
      arguments: { instructions: 'Summarise this document.', context_files: ['scan.pdf'] }
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not text/i);
  });

  it('surfaces an unreachable Ollama with an actionable message', async () => {
    const isolated = new Client({ name: 'test-client-2', version: '1.0.0' });
    await isolated.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_ENTRY],
        env: {
          PATH: process.env.PATH,
          OLLAMA_HOST: 'http://127.0.0.1:1',
          OLLAMA_MCP_ROOT: workspace
        }
      })
    );

    const result = await isolated.callTool({ name: 'ollama_list_models', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /ollama serve/);
    await isolated.close();
  });
});
