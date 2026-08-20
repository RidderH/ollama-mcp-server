# Model evals

These are **not** tests. `npm test` drives the MCP server over stdio against a stub Ollama:
deterministic, no GPU, safe in CI. Nothing here is. Every probe in this directory calls a
real local model, takes minutes, and can legitimately give a different answer each run.

They exist to answer one question: **where can the local model be trusted, and where can it
not?** The output is not a pass rate. It is a sentence that changes how work gets routed —
which is why every probe carries a `decision` field, and why a probe that cannot name one
does not belong here.

## Running

```bash
npm run test:evals            # the graders and the anti-drift guards — fast, no GPU
npm run evals                 # every probe, 3 repeats, ~30-45 min
node evals/run.mjs --only T1  # one probe
node evals/run.mjs --repeats 1
```

Results land in `evals/results/`: `raw-<stamp>.jsonl` (one line per call, including the
model's full output) and `summary-<stamp>.json`.

## Why the probes bypass MCP

They call `/api/chat` directly. Going through the MCP server would fold the client's
registration state and its 300 s call ceiling into every measurement, and a probe that dies
at 300 s tells you about Claude Code, not about the model. The probes use a far longer
timeout and flag `exceedsMcpCeiling` instead, so a slow-but-correct answer is recorded as
exactly that: correct, and unreachable through the tool.

`evals/lib/prompts.mjs` and `evals/lib/clean.mjs` are copies of shipped code, so the probes
grade the bytes the tools actually send and write. Copies drift, so each is pinned to the
compiled original by a test — `npm run build && npm run test:evals`.

## Method

- **Known answer, deterministic grader.** If an agent eyeballs the output, the result is as
  soft as the model. Fixtures live in `evals/fixtures/`, graders in `evals/lib/graders.mjs`.
- **The graders are guards, so they were proven to fail.** Every grader has a known-bad
  fixture asserting `pass === false`, and both anti-drift guards were watched going red on
  an injected divergence before being trusted. A grader only ever seen passing proves
  nothing about the run where the model misbehaves.
- **Vary something between repeats.** Identical prompt bytes plus a short answer reproduce
  exactly — 8 of 10 structured-output probes returned byte-identical text on all three
  repeats, making n=3 into n=1. The classification probes rotate their row order with the
  repeat number, which `run.mjs` passes to `build(repeat)`; grade by id, never by position.
- **n=3, worst case governs.** Routing should be decided by the floor, not the average: one
  bad run in three is a case that will come up. n=1 is exactly what left the existing rule
  hedging.
- **Serial.** One GPU, one loaded model; concurrency would ruin every latency number.
- **Warm-up first.** The first call after an idle period pays for weights coming off disk,
  which otherwise lands on whichever probe ran first.

No `seed` is exposed by the server (`src/schemas/common.ts` offers model, num_ctx,
temperature and disable_thinking), so repeats are the only control over variance.

## Probes

| id | gap | what it decides |
|---|---|---|
| `T1-preserve-small` | transform_files | whether a small-file transform can be reviewed by diff alone |
| `T3-preserve-large` | transform_files | the file size above which a transform must be split |
| `T2-no-op-instruction` | transform_files | whether a batch may contain files the instruction does not apply to |
| `T4-unknowable-rename` | transform_files | whether an instruction may reference anything outside the file |
| `E1-margin-without-cogs` | escape hatch | whether a delegated calculation can be trusted at all |
| `E2-purchases-without-opening-stock` | escape hatch | whether the observed sum-fabrication reproduces |
| `S1-flat` | structured output | whether a delegated result can be piped into a program at all |
| `S2-nested` | structured output | whether a caller must count the rows of an extracted table itself |
| `S3-enum` | structured output | whether a classification can be consumed by a switch statement |
| `S4-nullable` | structured output | whether a schema may contain a field the source cannot fill |
| `S5`/`S6` | structured output | whether `format` would have to force `disable_thinking` with it |
| `S7`/`S8` | structured output | whether `format` constrains anything at all, or only the prompt does |
| `C1-closed-list` | classification | whether a fixed list may be offered without a "none of these" |
| `C2-escape-offered` | classification | whether an escape category is enough on its own |
| `C3-closed-with-doubt` | classification | whether a confidence field can stand in for an escape category |
| `C4-escape-and-doubt` | classification | whether the confidence field still discriminates once nothing is forced |
| `D1`/`D2`/`D3` | dutch fidelity | the answer length at which Dutch notation or language would give out |

The `S` probes run twice each: **A** with the JSON Schema pasted into the prompt, which is what
the tools can do today, and **B** with the same prompt plus Ollama's own `format` field, which
`src/services/ollama.ts` does not send. B is not reachable through the tools as they ship; it is
measured because "add `format` to the server" is a decision the result can settle. A and B send
identical prompt bytes, so B lands on the prompt cache: the pair is valid for correctness and
**invalid for latency**.

The `E` probes run twice each: **A** without the Dutch escape-hatch sentence, **B** with it.
The shipped `DELEGATE_SYSTEM_PROMPT` already carries an `INSUFFICIENT:` escape hatch of its
own, so A is not a no-guard control — it is the tool as it ships, and B measures only what
the extra sentence adds.

## Where the findings go

The deliverable is prose in `~/.claude/rules/ollama-delegation.md`, not a green checkmark.
A probe result belongs there only if it changes a routing decision; anything else stays in
`evals/results/` as evidence.
