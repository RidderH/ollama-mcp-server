# ollama-mcp-server

An MCP server that lets an orchestrating agent — Claude Code, or anything else that speaks MCP — hand
self-contained subtasks to a small model running locally under [Ollama](https://ollama.com), and get a
structured result back.

The orchestrator keeps the plan and the wider context. This server is the button it presses to offload
grunt work: summarising long logs, writing docstrings, converting formats, first-pass triage. Nothing
leaves the machine, and the orchestrator never stops being in charge.

## Requirements

- Node.js 18 or newer
- Ollama running locally with at least one model pulled (`ollama pull qwen3.8:27b-mlx`)

## Install

```bash
npm install
npm run build
```

## Register with Claude Code

```bash
claude mcp add ollama -- node /absolute/path/to/ollama-mcp-server/dist/index.js
```

Or add it to `.mcp.json` in a project, which is the better option when you want the workspace root
pinned to that project:

```json
{
  "mcpServers": {
    "ollama": {
      "command": "node",
      "args": ["/absolute/path/to/ollama-mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_MCP_MODEL": "qwen3.8:27b-mlx",
        "OLLAMA_MCP_NUM_CTX": "32768",
        "OLLAMA_MCP_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Verify it loaded with `/mcp` inside Claude Code.

## Example

Two calls, with the figures they actually returned on an Apple-silicon machine running
`qwen3.8:27b-mlx`.

**Text in, structure out.** The orchestrator hands over captured output and asks for a verdict, and
gets one back without spending its own context on the log:

```jsonc
// ollama_delegate_task
{
  "instructions": "Below is the tail of a CI log. Name every test that failed and, for each, the one line that explains why. If nothing failed, answer exactly: no failures.",
  "context_text": "<4000 lines of log output>",
  "disable_thinking": true
}
```

**A picture in.** A context file that really is an image goes to the model as an image, so a scanned
table becomes readable data:

```jsonc
// ollama_delegate_task
{
  "instructions": "Read every row of the table in this image and return JSON: {\"rows\": [{\"quantity\": <int>, \"description\": \"<text>\", \"amount\": <number>}]}. If you cannot see the image, invent nothing and answer {\"readable\": false}.",
  "context_files": ["crop.png"],
  "num_ctx": 16384,
  "disable_thinking": true,
  "response_format": "json"
}
```

```json
{
  "output": "{ \"readable\": true, \"rows\": [ ... ] }",
  "model": "qwen3.8:27b-mlx",
  "insufficient": false,
  "prompt_tokens": 1369,
  "output_tokens": 601,
  "duration_ms": 25832,
  "context_files_read": 1,
  "images_sent": 1
}
```

A 126 KB PNG of a ten-row table cost **1.369 prompt tokens and 26 seconds**, and every one of the 31
extracted fields matched the known-good answer. Budget a page-sized image at roughly 1–2k tokens.

Two habits are worth copying from these calls. Give the model an **escape hatch** — a defined way to
say "I cannot" — so a gap in the input produces `{"readable": false}` instead of a confident
invention. And keep the instructions **complete on their own**: the local model sees none of the
conversation that led to the call.


## Tools

| Tool | Writes to disk | What it does |
| --- | --- | --- |
| `ollama_list_models` | no | Lists installed models, so the orchestrator picks a real tag instead of guessing |
| `ollama_get_model_info` | no | Reports a model's context length and capabilities |
| `ollama_delegate_task` | no | Runs a self-contained subtask locally and returns the answer |
| `ollama_transform_files` | **yes** | Applies one instruction across files, returning a unified diff each |

### `ollama_delegate_task`

The workhorse. Takes complete, self-contained instructions plus optional context (files read from disk,
or inline text such as captured log output) and returns the model's answer.

The local model sees only what this call passes it — none of the surrounding conversation — so the
instructions have to stand on their own. If the model decides the task is underspecified it replies
`INSUFFICIENT: …` rather than guessing, and the tool surfaces that as `insufficient: true` so the
orchestrator can rewrite the request instead of acting on a fabricated answer.

**Images.** A context file whose bytes say PNG, JPEG, GIF or WebP travels in Ollama's `images` field,
base64-encoded, and the prompt carries only an `<image path=… index=…/>` marker naming it. Sending a
picture as prompt text does not work at all: a 126 KB PNG decoded as UTF-8 became 87.656 prompt tokens
of mojibake and hit the runner's 5-minute wall, where the same picture costs about 1.200 image tokens.
Before the call the server checks the model advertises the `vision` capability, because Ollama accepts
the field regardless and a blind model answers confidently from the surrounding text alone.

Any other non-text file is refused with a message naming the conversion (`pdftotext -layout` for a
PDF's text layer, `pdftoppm -r 150 -png` for a page as an image) rather than decoded into bytes the
model cannot read.

### `ollama_transform_files`

Applies one instruction to each of up to 50 files, one request per file, writing results in place and
returning a unified diff for each. Suitable for repetitive edits that need no cross-file reasoning.

Three safeguards, because a small local model rewriting your source files deserves them:

- **`dry_run: true`** computes every diff without writing anything.
- **Truncation guard** — output that comes back under 40% of the original length is discarded rather
  than written. Small models sometimes return half a file or a `// rest unchanged` placeholder, and
  without this that response would silently destroy the file. A rejected rewrite always leaves the
  file untouched.
- **Fence and reasoning stripping** — markdown fences and `<think>` blocks never reach disk.

Per-file failures don't abandon the batch; each file reports its own status.

## Configuration

All optional, all environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API base URL |
| `OLLAMA_MCP_MODEL` | `qwen3.8:27b-mlx` | Model used when a call doesn't name one |
| `OLLAMA_MCP_NUM_CTX` | `32768` | Context window sent as `num_ctx` |
| `OLLAMA_MCP_TIMEOUT_MS` | `600000` | Per-request timeout |
| `OLLAMA_MCP_HEARTBEAT_MS` | `10000` | Progress heartbeat interval while a generation runs, keeping the client's idle timeout fed |
| `OLLAMA_MCP_ROOT` | process cwd | Directory all file paths are confined to |
| `OLLAMA_MCP_MAX_FILE_BYTES` | `400000` | Largest file the server will read |

### On `num_ctx`

Ollama defaults to a small context window — 4096 on most builds — and **silently truncates** anything
longer. There is no error; the model just appears to get worse. This server therefore always sends an
explicit `num_ctx` rather than relying on the default, and `ollama_get_model_info` will warn when the
configured value exceeds what the model actually supports.

## Security

- Every path is resolved and checked against `OLLAMA_MCP_ROOT`; traversal outside it is refused.
- Relative paths resolve against the root rather than the process cwd, so the two can't drift.
- The server only talks to the configured Ollama host, and logs to stderr only (stdout carries protocol
  traffic).
- File type is decided by magic bytes, not by extension, so a `.txt` that is really a JPEG is still
  handled as an image and a mislabelled binary is still refused.

## Development

```bash
npm run build     # compile to dist/
npm test          # build, then run the integration suite
npm run dev       # watch mode
```

The test suite drives a real MCP client over stdio against a stub Ollama, so it covers the server's own
behaviour — schema shape, fence stripping, the truncation guard, path sandboxing, batch error isolation,
image encoding and the vision pre-flight — without needing a model installed or producing flaky results.

## Notes on long-running calls

Local generation takes minutes, not seconds. The server emits MCP progress notifications while it
works, which is what clients support today.

The Tasks extension — where a server returns a handle immediately and the client polls — would suit this
workload better, but it currently ships as `experimental/tasks` in the TypeScript SDK and `registerTool`
doesn't yet expose the `execution.taskSupport` field. When that stabilises, the per-file loop in
`src/tools/transform.ts` is the natural place to adopt it.

## Licence

MIT — see [LICENSE](LICENSE).
