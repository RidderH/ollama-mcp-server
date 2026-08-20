# Findings — run 2026-08-20T09:45:33

`qwen3.8:27b-mlx`, 8 probes × 3 repeats = 24 calls, serial, warm model.
Raw: `raw-2026-08-20T09-45-33.jsonl` · summary: `summary-2026-08-20T09-45-33.json`

| probe | n | passed | wall | verdict |
|---|---|---|---|---|
| T1-preserve-small | 3 | 0 | 31–59 s | indentation shifted, content intact |
| T3-preserve-large | 3 | 0 | 123–190 s | same, at 297 lines |
| T2-no-op-instruction | 3 | 0 | 13 s | correct no-op, still re-indented |
| T4-unknowable-rename | 3 | 3 | 5–8 s | `CANNOT_COMPLY`, 3/3 |
| E1 margin — A no hatch | 3 | 3 | 10–11 s | `INSUFFICIENT:` 3/3 |
| E1 margin — B with hatch | 3 | 3 | 10–12 s | refused in prose, marker 0/3 |
| E2 purchases — A no hatch | 3 | 3 | 14–23 s | `INSUFFICIENT:` 3/3 |
| E2 purchases — B with hatch | 3 | 3 | 11–12 s | refused in prose, marker 0/3 |

## 1. `ollama_transform_files` never returns byte-clean output — but never loses content

**0/9 transform runs preserved the file byte for byte. 9/9 preserved every line of content.**

The failure is entirely whitespace. On the no-op probe (`novar.js`, an instruction with
nothing to match), `diff -w` between fixture and output is **empty** while plain `diff`
shows 8 changed lines — all of them a closing brace gaining a space:

```
15c15
<     } catch (error) {
---
>      } catch (error) {
```

Identical shift counts across all three repeats of each probe, so this is deterministic,
not sampling noise.

What did **not** happen, in any of the nine runs:

- no line of original content lost (exact multiset match on trimmed lines)
- no invented `import` or `require`
- no truncation — the tool's `MIN_OUTPUT_RATIO` guard was never triggered
- output always parsed (`node --check`)
- the requested edit was always performed, and only on the lines it applied to
  (`diff -w` shows every content change to be a JSDoc insertion and nothing else)

**Routing consequences.** The tool's `status: "unchanged"` will essentially never fire, so
it cannot be read as "the model declined to edit this file". Every transform lands
whitespace noise on lines the instruction never mentioned, which means a formatter run
after a transform is not optional, and a transform diff cannot be reviewed as if the
untouched lines were untouched. It also means the risk that made `dry_run` advice feel
urgent — silent content loss — did not appear here.

## 2. Transform size ceiling: ~300 lines, and it is generation-bound

297 lines / 9,098 bytes → 3,063 prompt tokens in, ~4,900 out, **123–190 s**. The prompt
side is trivial (~30 s); the wall is generation, because the model must re-emit the whole
file. At the observed floor of ~26 output tok/s, the 300 s MCP call ceiling is reached at
roughly 7,000 output tokens ≈ **400–450 lines of this density**.

**Routing consequence.** Keep a transform file under ~300 lines. Above that the call is
inside the ceiling only on a good run, and a slow run loses the whole batch item.

## 3. The model refuses cleanly when the answer is not in the file

`T4` asked for a rename whose new name lives in a module that was never supplied.
**3/3 returned exactly `CANNOT_COMPLY`** — no invented identifier, no silent pass-through.
Combined with finding 1, the transform tool's honesty surface is in better shape than its
fidelity surface.

## 4. The Dutch escape-hatch sentence costs the `INSUFFICIENT:` flag and buys nothing here

Both unanswerable tasks were refused correctly in **12/12** runs, with or without the
sentence. Neither trap number ever appeared. But the *shape* of the refusal differs, 6/6
against 0/6:

- **Without** the sentence, every answer opened `INSUFFICIENT: …`, which is the marker the
  shipped `DELEGATE_SYSTEM_PROMPT` asks for and which `delegate.ts` turns into
  `insufficient: true` on the tool result.
- **With** the sentence, not one answer used the marker. The refusals were correct Dutch
  prose — and invisible to any caller checking the flag.

The rule file credits the sentence with preventing fabrication. On this evidence the
shipped system prompt was already doing that, and the added sentence overrides the output
format it asks for.

**Limits of this result.** Both tasks were Dutch, both were flatly unanswerable, n=3 per
cell. It does not show the sentence is harmless in a task where the missing figure is
subtle rather than absent — the 2026-08-19 fabrication was of that kind and is not
reproduced by these two probes.

## 5. Fresh throughput numbers

End-to-end (wall includes prompt evaluation) across all 24 calls: **24–48 output tok/s,
median ≈ 32**. The rule file's "~27 tok/s" is the floor, not the typical rate; the slowest
observations are the long-generation runs (T3). Prompt evaluation stayed cheap at these
sizes — 3,063 tokens in ~30 s.

## What this changes in `~/.claude/rules/ollama-delegation.md`

1. Add a `transform_files` paragraph: content-safe, whitespace-unsafe, ~300 line cap,
   run a formatter after.
2. Rewrite the escape-hatch paragraph: prefer the shipped `INSUFFICIENT:` contract; the
   Dutch sentence suppresses it.
3. Correct the generation rate to a measured range.
