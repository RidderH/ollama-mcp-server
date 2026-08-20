#!/usr/bin/env node
/**
 * Probe runner.
 *
 * Serial by design: one GPU, one loaded model, and concurrent calls would make
 * every latency number meaningless. Each run is appended to a JSONL file the
 * moment it finishes, so a run that dies at probe 19 of 24 still leaves 18
 * usable measurements behind.
 *
 *   node evals/run.mjs                     # every probe, 3 repeats
 *   node evals/run.mjs --repeats 1         # a quick shakedown
 *   node evals/run.mjs --only T1           # one probe by id substring
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { generate, DEFAULT_MODEL, MCP_CALL_CEILING_MS } from './lib/ollama.mjs';
import { TRANSFORM_PROBES } from './probes/transform.mjs';
import { ESCAPE_HATCH_PROBES } from './probes/escape-hatch.mjs';
import { PLANNER_PROBES } from './probes/planner.mjs';
import { HAYSTACK_PROBES } from './probes/haystack.mjs';
import { STRUCTURED_PROBES } from './probes/structured.mjs';
import { CLASSIFY_PROBES } from './probes/classify.mjs';
import { DUTCH_PROBES } from './probes/dutch.mjs';

const ALL_PROBES = [
  ...TRANSFORM_PROBES,
  ...ESCAPE_HATCH_PROBES,
  ...PLANNER_PROBES,
  ...HAYSTACK_PROBES,
  ...STRUCTURED_PROBES,
  ...CLASSIFY_PROBES,
  ...DUTCH_PROBES
];

function parseArgs(argv) {
  const args = { repeats: 3, only: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repeats') args.repeats = Number.parseInt(argv[i + 1], 10);
    if (argv[i] === '--only') args.only = argv[i + 1];
  }
  return args;
}

/**
 * Load the model before timing anything.
 *
 * The first call after an idle period pays for weights coming off disk, which
 * would otherwise land on whichever probe happened to run first and be read as
 * that probe being slow.
 */
async function warmUp() {
  process.stderr.write('warm-up: loading the model… ');
  const result = await generate({
    system: 'Answer with one word.',
    prompt: 'Zeg: ja',
    disableThinking: true,
    timeoutMs: 300_000
  });
  process.stderr.write(result.ok ? `${result.wallMs} ms\n` : `FAILED: ${result.error}\n`);
  return result.ok;
}

function summarise(runs) {
  const byProbe = new Map();
  for (const run of runs) {
    const bucket = byProbe.get(run.probe) ?? [];
    bucket.push(run);
    byProbe.set(run.probe, bucket);
  }

  return [...byProbe.entries()].map(([probe, bucket]) => {
    const passes = bucket.filter((run) => run.pass).length;
    const wall = bucket.map((run) => run.wallMs);
    return {
      probe,
      gap: bucket[0].gap,
      question: bucket[0].question,
      decision: bucket[0].decision,
      n: bucket.length,
      passes,
      // Routing is governed by the floor, not the average: one bad run in three
      // is a case Claude will hit.
      worstCase: passes === bucket.length ? 'all passed' : 'at least one failure',
      wallMsMin: Math.min(...wall),
      wallMsMax: Math.max(...wall),
      // Repeats send identical bytes, which hit Ollama's prompt cache: at 25k
      // tokens the same prompt returned in 8 s against 154 s for one differing
      // only in where the needle sits. Only the first call in a group measures
      // a cold read, so it is reported apart rather than averaged in, which
      // would understate a fresh call by an order of magnitude. Repeats stay
      // meaningful for correctness -- generation is still sampled afresh.
      coldWallMs: bucket[0].wallMs,
      warmWallMs: bucket.slice(1).map((run) => run.wallMs),
      exceededMcpCeiling: bucket.filter((run) => run.exceedsMcpCeiling).length,
      promptTokens: bucket.map((run) => run.promptTokens),
      outputTokens: bucket.map((run) => run.outputTokens)
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const probes = args.only ? ALL_PROBES.filter((p) => p.id.includes(args.only)) : ALL_PROBES;

  if (probes.length === 0) {
    console.error(`No probe matches --only ${args.only}`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = new URL('./results/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const rawPath = new URL(`raw-${stamp}.jsonl`, dir);
  const summaryPath = new URL(`summary-${stamp}.json`, dir);

  console.error(`model: ${DEFAULT_MODEL}`);
  console.error(`probes: ${probes.length} x ${args.repeats} repeats = ${probes.length * args.repeats} calls`);
  console.error(`raw: ${rawPath.pathname}\n`);

  if (!(await warmUp())) {
    console.error('Ollama did not answer the warm-up. Is it running?');
    process.exit(1);
  }

  const runs = [];
  for (const probe of probes) {
    for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
      const label = `${probe.id} [${repeat}/${args.repeats}]`;
      process.stderr.write(`${label} … `);

      // Repeats send identical bytes unless a probe chooses otherwise, and
      // finding 25 showed that makes n=3 into n=1 wherever the answer is
      // short: 8 of 10 structured-output probes returned byte-identical text
      // on all three repeats. A probe that varies something harmless with the
      // repeat number -- the order of its rows, say -- buys back three real
      // observations, and defeats the prompt cache while it is at it.
      const { system, prompt, options = {} } = probe.build(repeat);
      const result = await generate({ system, prompt, ...options });

      let run;
      if (!result.ok) {
        run = {
          probe: probe.id,
          gap: probe.gap,
          question: probe.question,
          decision: probe.decision,
          repeat,
          pass: false,
          error: result.error,
          wallMs: result.wallMs,
          exceedsMcpCeiling: result.exceedsMcpCeiling ?? false
        };
        process.stderr.write(`ERROR after ${Math.round(result.wallMs / 1000)}s: ${result.error}\n`);
      } else {
        const graded = await probe.grade(probe.output === 'text' ? result.cleanedText : result.cleanedFile);
        run = {
          probe: probe.id,
          gap: probe.gap,
          question: probe.question,
          decision: probe.decision,
          repeat,
          pass: graded.pass,
          detail: graded.detail,
          wallMs: result.wallMs,
          exceedsMcpCeiling: result.exceedsMcpCeiling,
          thought: result.thought,
          promptTokens: result.promptTokens,
          outputTokens: result.outputTokens,
          rawOutput: result.text
        };
        const ceiling = result.exceedsMcpCeiling ? ` OVER-${Math.round(MCP_CALL_CEILING_MS / 1000)}s-MCP-CEILING` : '';
        process.stderr.write(
          `${graded.pass ? 'pass' : 'FAIL'} (${Math.round(result.wallMs / 1000)}s, ` +
            `${result.promptTokens ?? '?'}p/${result.outputTokens ?? '?'}o)${ceiling}\n`
        );
      }

      runs.push(run);
      appendFileSync(rawPath, `${JSON.stringify(run)}\n`);
    }
  }

  const summary = {
    model: DEFAULT_MODEL,
    startedAt: stamp,
    repeats: args.repeats,
    probes: summarise(runs)
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.error('\n--- summary (worst case governs) ---');
  for (const probe of summary.probes) {
    console.error(
      `${probe.probe}: ${probe.passes}/${probe.n} passed, ` +
        `${Math.round(probe.coldWallMs / 1000)}s cold` +
        (probe.warmWallMs.length > 0
          ? ` (then ${probe.warmWallMs.map((ms) => Math.round(ms / 1000)).join('/')}s cached)`
          : '') +`` +
        (probe.exceededMcpCeiling > 0 ? `, ${probe.exceededMcpCeiling} over the MCP ceiling` : '')
    );
  }
  console.error(`\nsummary: ${summaryPath.pathname}`);
}

await main();
