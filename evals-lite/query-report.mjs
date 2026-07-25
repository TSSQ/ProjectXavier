#!/usr/bin/env node
/**
 * Human-readable eval surface for the layer AFTER the query gate
 * (docs/design/ask-xavier-queries-spec.md §5.2/§5.3) — reads the SAME
 * tests/query-corpus.jsonl the jest suite (tests/__steps__/query-corpus.
 * steps.ts) asserts against, runs every case through the deterministic floor
 * (`src/domain/queryFloor.ts`'s `resolveFloorQueryCall`) and the shared period
 * extractor (`src/domain/periodRange.ts`'s `resolvePeriodFromText`), and
 * prints a per-dimension pass/fail table (tool routing, period extraction,
 * category extraction) plus a per-tool breakdown. Mirrors
 * evals-lite/intent-report.mjs's shape and "100% bar, not a statistical
 * threshold" doctrine — both routing and period/category resolution are
 * fully deterministic, so `npm run eval:query` is the thing to run green
 * before landing any change to queryFloor.ts's patterns or periodRange.ts's
 * extraction rules (see the "no gate change without a corpus case first"
 * rule now documented in both files' headers).
 *
 * `expectTool`/`expectCategory` of `null` means "skip that dimension's
 * assertion for this line" — used for genuine floor gaps (top_payees/
 * search_transactions aren't implemented at all) and one accepted, documented
 * single-shot-loop limitation (a multi-period comparison falls back to
 * this_month); see tests/__steps__/query-corpus.steps.ts's header. Two
 * PREVIOUSLY-null lines (the earn/earned income-verb gap, and the trend/
 * average keyword collision on total_spent) were genuine bugs this corpus
 * caught — both are now fixed in queryFloor.ts and relabeled to assert the
 * ideal behavior. `expectPeriod` is never skipped.
 *
 * Run with `npm run eval:query` (wired to `tsx`, no build step, same as
 * eval:intent).
 *
 * ── Model-tier hook (seam only) ─────────────────────────────────────────────
 * `--engine=<fm|openai|anthropic>` grades the SAME corpus against a model
 * tier instead of the deterministic floor — report-only, never gating the
 * build (unlike the floor/period table above, which IS a 100% bar). `fm`
 * always reports "skipped" (Foundation Models is on-device only — see
 * src/features/ai/deviceParse.ts's `deviceParseQuerySelection` — and cannot
 * run headless in this Node environment). `openai`/`anthropic` look for
 * OPENAI_API_KEY/ANTHROPIC_API_KEY in the environment; when absent, they
 * print "skipped — no key" and exit 0 (mirrors the "no-op-green" shape of
 * this repo's other key-gated dev tooling, e.g. src/features/ai/testKey.ts's
 * "Test key" round-trip, which no-ops rather than fails when nothing is
 * configured).
 *
 * TODO(model-tier): even WITH a key, wiring a real call is intentionally left
 * unimplemented here — this worktree has no `.env` of its own (the keys live
 * at the main checkout's repo root, `/…/ProjectXavier/.env`, a different
 * directory than this worktree), and the real design (a single BYOK
 * tool-selection round against `src/domain/queryTools.ts`'s
 * `QUERY_TOOL_DEFS`, reusing `src/features/ai/engines/openai.ts`/
 * `anthropic.ts`'s raw-fetch pattern but grading the FIRST round's tool call
 * instead of executing it) deserves its own review before it starts spending
 * a real API budget inside an eval script. Left as a flag + this documented
 * TODO per this task's own explicit allowance — does not block the
 * deterministic floor/period grading above, which is unaffected by
 * `--engine` and always runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFloorQueryCall } from '../src/domain/queryFloor.ts';
import { resolvePeriodFromText } from '../src/domain/periodRange.ts';

// Mirrors jest.config.js's own TZ pin — period extraction depends on the
// process's local calendar (getFullYear/getMonth), so this script must
// resolve "in March"/"this year" identically to the jest suite regardless of
// the machine it runs on.
if (!process.env.TZ) process.env.TZ = 'UTC';

// Same fixed instant as tests/__steps__/query-corpus.steps.ts (and the
// query-floor/period-range suites it mirrors) — 15 July 2026, mid-month/
// mid-year so no boundary is ambiguous.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(__dirname, '../tests/query-corpus.jsonl');

function loadCorpus() {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function periodsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function categoryOf(call) {
  return call && typeof call === 'object' && call.params ? call.params.category : undefined;
}

function runDeterministicReport(corpus) {
  const dims = {
    tool: { pass: 0, total: 0 },
    period: { pass: 0, total: 0 },
    category: { pass: 0, total: 0 },
  };
  /** @type {Record<string, { pass: number; total: number }>} */
  const perTool = {};
  const failures = [];

  for (const c of corpus) {
    const call = resolveFloorQueryCall(c.text, NOW);
    const period = resolvePeriodFromText(c.text, NOW);

    // Period is ALWAYS graded.
    dims.period.total++;
    const periodOk = periodsEqual(period, c.expectPeriod);
    if (periodOk) dims.period.pass++;
    else failures.push({ text: c.text, dim: 'period', expected: c.expectPeriod, actual: period, note: c.note });

    // Tool is graded only when expectTool isn't null (see file header).
    if (c.expectTool !== null) {
      dims.tool.total++;
      const toolBucketKey = c.expectTool;
      perTool[toolBucketKey] ??= { pass: 0, total: 0 };
      perTool[toolBucketKey].total++;
      const actualTool = call?.tool ?? null;
      const toolOk = actualTool === c.expectTool;
      if (toolOk) {
        dims.tool.pass++;
        perTool[toolBucketKey].pass++;
      } else {
        failures.push({ text: c.text, dim: 'tool', expected: c.expectTool, actual: actualTool, note: c.note });
      }
    }

    // Category is graded only when expectCategory isn't null.
    if (c.expectCategory !== null) {
      dims.category.total++;
      const actualCategory = categoryOf(call);
      const categoryOk = actualCategory === c.expectCategory;
      if (categoryOk) dims.category.pass++;
      else {
        failures.push({
          text: c.text,
          dim: 'category',
          expected: c.expectCategory,
          actual: actualCategory ?? null,
          note: c.note,
        });
      }
    }
  }

  console.log('Query floor + period eval — tests/query-corpus.jsonl\n');
  console.log(`corpus size: ${corpus.length}\n`);
  console.log('dimension   pass/total');
  console.log('----------  -----------');
  for (const dim of ['tool', 'period', 'category']) {
    const { pass, total } = dims[dim];
    console.log(`${dim.padEnd(10)}  ${pass}/${total}`);
  }
  console.log('');

  console.log('per-tool breakdown (tool dimension only)');
  console.log('---------------------------------------');
  for (const toolName of Object.keys(perTool).sort()) {
    const { pass, total } = perTool[toolName];
    console.log(`${toolName.padEnd(24)}  ${pass}/${total}`);
  }
  console.log('');

  if (failures.length > 0) {
    console.log(`FAILURES (${failures.length}):\n`);
    for (const f of failures) {
      console.log(`  "${f.text}"  [${f.dim}]`);
      console.log(`    expected: ${JSON.stringify(f.expected)}  actual: ${JSON.stringify(f.actual)}`);
      console.log(`    note: ${f.note}\n`);
    }
    console.log(`FAIL — ${failures.length} assertion(s) failed.`);
    return false;
  }

  console.log('PASS — every graded dimension is 100%.');
  return true;
}

function parseEngineFlag(argv) {
  const arg = argv.find((a) => a.startsWith('--engine='));
  return arg ? arg.slice('--engine='.length) : null;
}

/**
 * Report-only model-tier seam — see the file header's TODO. Never affects
 * this script's exit code (the deterministic floor/period report above is
 * the only thing that gates `npm run eval:query`).
 */
function runModelTierReport(engine) {
  console.log(`\nModel tier (--engine=${engine}) — report-only, does not affect exit code.`);

  if (engine === 'fm') {
    console.log('skipped — Foundation Models is on-device only and cannot run headless in this Node environment.');
    return;
  }

  if (engine !== 'openai' && engine !== 'anthropic') {
    console.log(`skipped — unrecognised engine "${engine}" (expected fm, openai, or anthropic).`);
    return;
  }

  const envKey = engine === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = process.env[envKey];
  if (!key) {
    console.log(`skipped — no key (${envKey} not set in this environment).`);
    console.log(
      'TODO(model-tier): even with a key, the real call isn\'t wired up in this worktree — see the ' +
        'file header TODO (no .env here; the design would reuse a single BYOK tool-selection round ' +
        'against src/domain/queryTools.ts\'s QUERY_TOOL_DEFS, graded report-only against this same corpus).'
    );
    return;
  }

  console.log(
    `skipped — a key is present for ${engine}, but the real model-tier call is not wired up yet ` +
      '(see the file header TODO — this is a documented seam, not a no-op due to a missing key).'
  );
}

function main() {
  const corpus = loadCorpus();
  const deterministicPassed = runDeterministicReport(corpus);

  const engine = parseEngineFlag(process.argv.slice(2));
  if (engine) runModelTierReport(engine);

  process.exit(deterministicPassed ? 0 : 1);
}

main();
