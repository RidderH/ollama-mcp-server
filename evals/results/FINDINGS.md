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

---

# Findings — run 2026-08-20T10:28:23 (E3)

One probe × 2 variants × 3 repeats. Raw: `raw-2026-08-20T10-28-23.jsonl`.

Closes the hole left open by finding 4: E1 and E2 asked outright for a figure that was
absent, which is the easy case. E3 asks a **judgement** question — *"welke posten verdienen
een waarschuwing?"* — over a table whose norm refers to a purchase volume that is not in
it. Nothing asks for that number; it is only needed to answer well. This is the shape of
the 2026-08-19 fabrication.

| variant | n | passed | `INSUFFICIENT:` | named the gap | trap hit |
|---|---|---|---|---|---|
| A — no hatch | 3 | 3 | 0/3 | 3/3 | 0/3 |
| B — with hatch | 3 | 3 | 0/3 | 3/3 | 0/3 |

## 6. The fabrication did not reproduce

**0/6 runs invented a purchase figure**, with or without the sentence. Every run named the
gap in the same sentence as the topic — the strict `gradeNamedGap` check, not a vague hedge
elsewhere in the text:

- *"De rapportage bevat geen inkoopcijfer, dus de norm kan niet direct worden geverifieerd"*
- *"Inkoop ontbreekt in de rapportage → **waarschuwing**"*
- *"Zowel de **voorraad per 1-08** als het **inkoopaantal** ontbreken"*

A separate sweep for any purchase-shaped number outside the four trap values found none:
the only sentences pairing "inkoop" with a figure were line items naming the missing row
("Inkoop augustus 2026 (aantal stuks)"). One run went further than asked and flagged the
opening stock as missing too, which is correct and was not required.

Every unsourced number was a legitimate derivation — 3,4 (2.140/63.065 as a return rate),
1,1 (the 110% norm), 0,9 (stock against sales). Nothing invented.

**Caveat, and it is a real one.** The norm sentence names "inkoop" explicitly, so the
missing quantity is *nameable*. A gap the source never names anywhere may still behave like
2026-08-19. This run shows the failure is not deterministic on a task of this shape; it does
not show it cannot happen.

## 7. The `insufficient` flag does not fire on judgement questions

The sharpest result of this run, and it is not about the escape hatch at all.

**0/6 used the `INSUFFICIENT:` marker — including the three runs with no added
instruction**, where E1 and E2 used it 6/6. The model does not treat a judgement question
with a hole in it as unanswerable. It answers, and reports the hole *as one of the
warnings* — which for this task is the better behaviour.

**Routing consequence.** `insufficient: true` is a reliable signal only when the question
asks straight out for a value. On an analysis or judgement task the flag stays false whether
or not the model found the data wanting, so it cannot be used as a gate there — the answer
has to be read.

---

# Findings — run 2026-08-20T12:13:07 (E4)

One probe × 2 variants × 3 repeats. Raw: `raw-2026-08-20T12-13-07.jsonl`.

E3 left one hole: its norm used the word "inkoop", so the missing quantity was *nameable*.
E4 removes that. A table gives omzet, personeelskosten, magazijnkosten and units sold, and
asks whether the article clears a "25% of revenue must remain" norm. The purchase cost of
the goods is absent and named nowhere. Nothing invites the model to look for it — it has to
know that a cost list without cost of goods cannot be complete.

| variant | n | passed | trap figure asserted | named the gap | verdict given |
|---|---|---|---|---|---|
| A — no hatch | 3 | 0 | 3/3 | **0/3** | "gezond" 3/3 |
| B — with hatch | 3 | 0 | 3/3 | **2/3** | "gezond" 3/3 |

## 8. The 2026-08-19 failure reproduces exactly — and the sentence is what softens it

**This overturns finding 4's blanket conclusion.** On this task the escape-hatch sentence is
not decoration.

Without it, all three runs produced this and nothing else:

> Rest na kosten **€ 22.765** → **36,1 %** → *"Ja, artikel B-42 is gezond volgens de norm."*

No hedge, no caveat, no hint that the cost list is short. That is the 2026-08-19 failure in
miniature: not an invented number, but **a verdict drawn from an incomplete list and stated
as fact**. The arithmetic is flawless and the conclusion is unfounded.

With the sentence, the same computation and the same verdict — but 2 of 3 runs relabelled
the row *"Rest na **bekende** kosten"* and added:

> *"De rapportage bevat slechts twee kostenposten… Mogelijke andere kosten — bijvoorbeeld
> inkoop-/aanschafkosten, transport, administratie of afschrijving — staan niet in de
> gegevens… Het getal dat dan mist, is het **totaal van de overige kosten** (of, equivalent,
> de inkoopprijs per stuk × 4.310 stuks)."*

That is precisely what the sentence asks for, and it arrives unprompted by anything else in
the task. One run of the three still gave the bare verdict, so it is 2/3, not a guarantee.

**Neither variant prevented the wrong verdict.** All six said "gezond". The sentence does not
make the model refuse; it makes it show its exposure. That is worth having and is not the
same as safety.

## 9. Why E3 passed and E4 failed — the mechanism

E3's norm named "inkoop"; E4's names nothing. Same model, same shape of hole, opposite
outcome. **Salience of the gap, not its size, decides whether it gets flagged or filled.**
This was a guess after E3 and is now the measured difference between the two runs.

**Routing consequence, and it is the sharpest one in the whole exercise.** Before delegating
any judgement over a table, check the completeness of the table yourself: does every
quantity the question or norm depends on actually appear in it? If one is missing, the model
will not find it for you — it will compute confidently around the hole. Name the missing
quantity in the prompt and it flags it (E3); leave it unnamed and it does not (E4).

---

# Findings — run 2026-08-20T13:26:42 (planner pattern, gap #3)

6 probes × 3 repeats. Raw: `raw-2026-08-20T13-26-42.jsonl`.

The rule file's strongest recommendation — *"reach for this first whenever a task scales with
row count"* — rested on one `awk` one-liner. These probes send the header, one sample row and
the question, never the data, and **execute what comes back** against a 200-row fixture whose
answer was verified independently (`207862.49`). A reference solution was written by hand for
every tool first, and all five produce that answer, so no probe asks the impossible.

| probe | tool | n | passed | wall | how the failures failed |
|---|---|---|---|---|---|
| P3-sqlite-total | sqlite3 | 3 | **3/3** | 41–46 s | — |
| P4-python-csv-total | python3 | 3 | **3/3** | 40–53 s | — |
| P6-awk-total-dialect-named | awk | 3 | **3/3** | 92–103 s | — |
| P1-awk-csv-total | awk | 3 | 1/3 | 72–156 s | **silent**: exit 0, plausible number |
| P5-awk-csv-top3 | awk | 3 | 1/3 | 100–104 s | **silent**: exit 0, garbage categories |
| P2-jq-json-total | jq | 3 | 0/3 | 104–142 s | loud: exit 3, empty stdout |

## 10. The pattern itself holds, and it is cheap

Every prompt cost **385–456 tokens** regardless of the 200 rows behind it, and the correct
answers were exact to the cent from a model that never saw a data row. The claim that a model
which cannot count 500 rows can still write the command that counts them is **confirmed** —
that part of the rule survives contact with four tools and an ugly schema.

What does not survive is "reach for this first" without saying *with which tool*.

## 11. `awk` fails silently; `jq` fails loudly; sqlite and python do not fail

This distinction matters more than the pass rate.

**Silent (awk).** Two of three unqualified runs used `FPAT`, which is a **gawk** extension. BSD
awk — what macOS ships, and gawk is not installed here — ignores the flag without a word:

```
awk -v FPAT='([^,]*)|("[^"]*")' '…' boekingen.csv   →  exit 0, empty stderr, "0.00"
```

The other silent failure printed `0.97`. On P5 the garbage was more visible (`filiaal 84.00`,
`zn.", 0.00` as category names) but still exited 0. **A well-formed wrong number with no error
is the worst outcome this pattern can produce**, and it is what awk produced 4 times out of 6.

**Loud (jq).** All three jq runs failed identically: `jq: error: gsub/1 is not defined`. The
model wrote `gsub(",", ".")` with a comma where jq separates arguments with a semicolon — and
got the neighbouring `gsub("\\."; "")` right in the same expression. A specific, reproducible
confusion, not general incompetence. Cost: a retry. Risk: none.

**Clean (sqlite3, python3).** 3/3 each, and roughly **twice as fast** as the awk attempts
(41–53 s against 72–156 s) on a third to a half of the output tokens. The tools it is fluent
in are also the cheap ones.

## 12. Naming the dialect fixed it, 1/3 → 3/3

P6 is P1 plus one sentence: *"dit draait op macOS met de BSD-versie van awk, niet gawk;
FPAT, gensub() en IGNORECASE bestaan daar niet"*.

All three runs then abandoned `FPAT` and hand-rolled a character-by-character CSV parser —
the portable approach, and the same one the single passing P1 run had found on its own. The
model knows how to do it; unprompted, it reaches for the extension first.

Whether "name the pitfall" generalises beyond awk is untested: it is one tool, n=3.

## 13. What this changes

1. **Prefer sqlite3 or python3.** 3/3, fastest, cheapest, no dialect trap.
2. **If it must be awk, name the dialect in the prompt.** One sentence, 1/3 → 3/3.
3. **"Run the command and check its output" is not enough** — that is what the rule says now,
   and it would have passed `0.00` straight through. Verification has to be able to fail:
   run the command against a small slice whose answer you already know, or have a second tool
   agree, before trusting it on the full data.

---

# Findings — runs 2026-08-20T14:02 (P7) and 14:14 (P8): does "name the pitfall" generalise?

P6 turned awk from 1/3 into 3/3 with one sentence naming the dialect. That is one tool, so
the same treatment was given to jq — twice, because the first attempt was confounded.

| probe | hint | passed | how the failures failed |
|---|---|---|---|
| P2-jq | none | 0/3 | loud 3/3 (`gsub/1 is not defined`) |
| P7-jq | pitfall named, spelled `gsub("a", "b")` | 0/3 | 1 loud, 1 exit 5, **1 silent `0.00`** |
| P8-jq | pitfall named with placeholders | 0/3 | loud 3/3 |

## 14. P7 was confounded by its own wording — recorded rather than quietly rerun

P7's hint spelled the counter-example out as `gsub("a", "b")` — a comma followed by a space.
The two runs that adopted the hint then wrote `", "` as the *search pattern* where the
unhinted P2 runs had written `","`, so the decimal comma was never replaced. The change
coincides exactly with the hint's introduction, which makes the wording the prime suspect
and P7's result unusable for the question it was built to answer. P8 repeats it with
placeholders and no literal string to copy.

**A hint can teach the error it warns about.** Worth remembering the next time a prompt is
"clarified" with an example.

## 15. It does not generalise: 0/9 for jq against 3/3 for awk

The `gsub` calls inside a single P8 command tell the whole story:

| run | `gsub("^\s+|\s+$"; "")` | `gsub("\\."; "")` | the comma one |
|---|---|---|---|
| rep1 | `;` correct | `;` correct | `gsub(",", ".")` — comma |
| rep2 | `;` correct | `;` correct | `gsub(",", ".")` — comma |
| rep3 | `;` correct | `;` correct | `gsub(","; ".")` correct — then died on `printf/2 is not defined` |

The model is not ignorant of jq's separator: it applies it correctly twice in the same
expression and fails on the one call whose argument is itself a comma. The literal comma in
the string bleeds into the separator position. The neutral hint fixed that in 1 of 3 — and
that run promptly tripped over `printf`, which is not a jq builtin at all.

**So the rule is about the shape of the failure, not the tool.** Naming the pitfall rescued
awk because awk's failure was *one coherent wrong assumption* (wrong dialect) that the model
could route around with knowledge it already had — told the extension was absent, it
hand-rolled a parser. jq's failures are a *cluster of small independent gaps*: close one and
the next is exposed. Nothing in the output tells you in advance which kind you have.

**Routing consequence.** Do not try to hint a weak tool into working. One clarifying sentence
is worth trying once; if it does not land, switch tools rather than write a third. sqlite3
and python3 were 3/3 first time with no hints at all.

## 16. Correction to finding 11: jq does not always fail loudly

P7 rep2 ended its pipeline with `jq -r '…' boekingen.json | printf "%.2f\n"`. `printf` does
not read stdin, and a pipeline exits with the status of its *last* command — so jq's error
went to stderr while the shell reported **exit 0 and printed `0.00`**.

| check | catches awk's `0.00`? | catches jq's `0.00`? |
|---|---|---|
| does the output look right | no | no |
| exit code non-zero | no | **no** |
| stderr non-empty | no | yes |
| compare against a known answer | **yes** | **yes** |

Both tools have now produced a well-formed wrong number with a zero exit status, by different
routes. Only comparison against a known answer caught both.
