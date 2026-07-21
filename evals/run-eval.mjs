#!/usr/bin/env node
/**
 * `npm run eval` / `npm run eval:cloud` — the Tier-1 JS gate (dev tooling,
 * never ships; see docs/design/parse-eval-pipeline-spec.md). No Python venv
 * required: this drives the REAL `evals/engines/run_node.mjs` runner (which
 * imports the app's actual parse code) and scores it with the plain-JS
 * `evals/score.mjs` (proven equal to `evals/scoring.py` by
 * `evals/test-score.mjs`).
 *
 * Usage:
 *   node evals/run-eval.mjs                 # heuristic engine (default) — no keys
 *   node evals/run-eval.mjs --engine=anthropic   # cloud engine — key-gated
 *   node evals/run-eval.mjs --engine=fm          # on-device model — FM_PROBE_PATH-gated
 *   node evals/run-eval.mjs --engine=fm --n=5    # repeat every case 5x, gate on pass-rate
 *
 * Gating:
 *   - `heuristic` (the default, no-key tier): exits non-zero if overall
 *     accuracy drops below the committed `evals/baseline.json`, or if any
 *     case that passed at baseline now fails.
 *   - any other engine (the model tiers, `anthropic`/`fm`): if no key/probe is
 *     configured, the underlying runner reports every case `skipped` — this
 *     script then prints `skipped` and exits 0 (never blocks a build on a
 *     missing BYOK key or an FM-incapable machine). With a key/probe present,
 *     it grades against the lenient thresholds in `evals/thresholds.json`
 *     instead of the baseline file.
 *   - `--n=<N>` (model tiers only; default 1): both `fm` and `anthropic` are
 *     nondeterministic, so `/build`'s preflight repeats every case N=5 times
 *     and gates on PASS-RATE (the fraction of runs where a case scored
 *     correct) rather than a single sample — `thresholds.model.perCase` is
 *     the bar an individual case's pass-rate must clear to count as
 *     "reliable"; `thresholds.model.overall` is the bar the fraction of
 *     reliable cases must clear. `--n=1` (the default) is exactly the
 *     original single-sample behavior, unchanged.
 *
 * Every invocation (any engine) also runs `evals/fm/check-sync.mjs` first —
 * a pure string check (no FM, no Swift compile) confirming the Swift probe's
 * mirrored prompt/schema strings haven't drifted from
 * `src/domain/deviceParsePrompt.ts`. This keeps the two prompt copies honest
 * even on a machine with no Foundation Models/Swift toolchain at all.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, scoreCase } from './score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Load .env (local-dev convenience) so key/model overrides reach both this
// script's artifact metadata (engineModel) and — via inherited process.env —
// the child runner. Tolerant of a missing file: CI has no .env and injects
// keys through the job's `env:` block (mirrors evals/engines/run_node.mjs).
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  // No .env present (e.g. CI) — the process env is authoritative.
}
const DATASET_PATH = path.join(__dirname, 'dataset.jsonl');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');
const CHECK_SYNC_PATH = path.join(__dirname, 'fm', 'check-sync.mjs');
// Committed per-run provenance artifacts (evals/results/<engine>.json) — a
// durable, machine-readable record of the last run of each engine (scores,
// git SHA, timestamp, gate outcome). Committed on purpose so a repo reader can
// trace "what did the eval say" without re-running it or needing a key/FM;
// contains only scores + metadata, never a key or any dataset PII.
const RESULTS_DIR = path.join(__dirname, 'results');

/** Short HEAD SHA for provenance; 'unknown' if git is unavailable. */
function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** Model identifier recorded in the artifact, matching what the engine ran. */
function engineModel(engine) {
  if (engine === 'anthropic') return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  if (engine === 'fm') return 'apple-foundation-models (on-device)';
  if (engine === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return 'localParse (heuristic, src/domain/localParse.ts)';
}

/** Write evals/results/<engine>.json. `generatedAt` is a wall-clock ISO
 *  string — fine here (this is a normal CLI, not a resumable workflow). */
function emitResult(engine, payload) {
  // A provenance-write failure must NEVER change the gate's exit code (review
  // nit #4): if evals/results/ is unwritable, warn and carry on with the
  // already-computed pass/fail rather than throwing an uncaught exception that
  // would surface a passing gate as a spurious non-zero (a false build block).
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const out = {
      engine,
      model: engineModel(engine),
      gitSha: gitSha(),
      generatedAt: new Date().toISOString(),
      datasetFile: 'evals/dataset.jsonl',
      metric:
        'asserted-fields: amountMinor/sign/dateISO scored on every case; category/payee only when the label asserts them; overall = all asserted fields correct (see evals/scoring.py).',
      ...payload,
    };
    writeFileSync(path.join(RESULTS_DIR, `${engine}.json`), JSON.stringify(out, null, 2) + '\n');
  } catch (e) {
    console.error(`eval: could not write ${engine} result artifact (non-fatal): ${e.message}`);
  }
}

/** Shape a report's scores into the committed-artifact schema. */
function scorePayloadFromReport(report) {
  return {
    overall: {
      correct: report.counts.overallCorrect,
      total: report.counts.overallTotal,
      accuracy: report.overallAccuracy,
    },
    failToParse: {
      correct: report.counts.failToParseCorrect,
      total: report.counts.failToParseTotal,
    },
    fields: Object.fromEntries(
      Object.keys(report.fieldAccuracy).map((f) => [
        f,
        {
          correct: report.fieldCounts[f].correct,
          total: report.fieldCounts[f].total,
          accuracy: report.fieldAccuracy[f],
        },
      ])
    ),
  };
}

/** Run the FM contract-sync guard as a subprocess so its own stdout/exit code
 *  surface directly — never re-implemented here (see evals/fm/check-sync.mjs). */
function runCheckSync() {
  try {
    execFileSync('node', [CHECK_SYNC_PATH], { stdio: 'inherit', cwd: REPO_ROOT });
  } catch {
    console.error('\neval: check-sync failed — see above.');
    process.exit(1);
  }
}

function parseArgs(argv) {
  let engine = 'heuristic';
  let n = 1;
  for (const arg of argv) {
    if (arg.startsWith('--engine=')) engine = arg.slice('--engine='.length);
    if (arg.startsWith('--n=')) n = Number(arg.slice('--n='.length));
  }
  if (!Number.isInteger(n) || n < 1) n = 1;
  return { engine, n };
}

function loadCases() {
  return readFileSync(DATASET_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Shell out to the REAL engine runner (never re-implemented here) and parse
 *  its JSON stdout. */
function runEngine(engine) {
  const stdout = execFileSync(
    'npx',
    ['tsx', path.join(__dirname, 'engines', 'run_node.mjs'), engine, DATASET_PATH],
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

/** Whether one case counts as "passing" for baseline/regression purposes —
 *  a fail-to-parse case (`expected: null`) passes iff the engine returned
 *  `null`; any other case passes iff every scored field matches. An `error`
 *  status never counts as passing. */
function casePassed(caseObj, result) {
  if (!result || result.status === 'error') return false;
  const scored = scoreCase(caseObj.expected ?? null, result.parse ?? null);
  return scored.failToParseCase ? scored.correct : scored.overall;
}

function pct(n) {
  return n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
}

function printAxisTable(cases, resultsById) {
  const byAxis = new Map();
  for (const c of cases) {
    const r = resultsById.get(c.id);
    const entry = byAxis.get(c.axis) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (casePassed(c, r)) entry.correct += 1;
    byAxis.set(c.axis, entry);
  }
  console.log('\nPer-axis accuracy:');
  for (const [axis, { correct, total }] of [...byAxis.entries()].sort()) {
    console.log(`  ${axis.padEnd(18)} ${correct}/${total}  (${pct(correct / total)})`);
  }
}

function printFieldTable(engineReport) {
  console.log('\nPer-field accuracy:');
  for (const [field, acc] of Object.entries(engineReport.fieldAccuracy)) {
    // category/payee are ASSERTED fields — the denominator is only the
    // cases whose label actually asserted that field (see score.mjs's
    // scoring-fairness note), so print it alongside the accuracy to make
    // that explicit (e.g. "category 6/8").
    const { correct, total } = engineReport.fieldCounts[field];
    console.log(`  ${field.padEnd(14)} ${pct(acc)}  (${correct}/${total})`);
  }
}

/** Per-case pass-rate across N repeated runs of a nondeterministic (model
 *  tier) engine — `runs` is an array of N `runEngine()` results, each the
 *  full per-case array for one full pass over the dataset. Returns
 *  `Map<caseId, { passes, total, passRate }>`. */
function computePassRates(cases, runs) {
  const rates = new Map();
  for (const c of cases) {
    let passes = 0;
    for (const run of runs) {
      const r = run.find((x) => x.id === c.id);
      if (casePassed(c, r)) passes += 1;
    }
    rates.set(c.id, { passes, total: runs.length, passRate: passes / runs.length });
  }
  return rates;
}

function printPassRateTable(cases, passRates, perCaseThreshold) {
  console.log(`\nPer-case pass-rate (N=${cases.length ? [...passRates.values()][0].total : 0}):`);
  for (const c of cases) {
    const { passes, total, passRate } = passRates.get(c.id);
    const flag = passRate >= perCaseThreshold ? ' ' : ' *';
    console.log(`  ${c.id.padEnd(24)} ${passes}/${total}  (${pct(passRate)})${flag}`);
  }
  console.log(`  (* below the ${pct(perCaseThreshold)} per-case threshold)`);
}

/** Gate a model-tier engine run repeated N times: a case counts as
 *  "reliable" iff its pass-rate clears `thresholds.model.perCase`; the run
 *  overall passes iff the fraction of reliable cases clears
 *  `thresholds.model.overall`.
 *
 *  KNOWN DENOMINATOR MISMATCH (review nit #1 — reconcile BEFORE flipping the
 *  /build FM preflight from report-only to blocking): this fraction is over
 *  `cases.length` (ALL 39, incl. the 7 easy fail-to-parse cases), whereas the
 *  single-sample `gateAgainstThresholds` grades `report.overallAccuracy` over
 *  the 32 non-fail cases only. So the same `thresholds.model.overall` (0.80) is
 *  slightly more lenient here. Harmless while FM is report-only + cloud is
 *  on-demand; align the denominators before either gate blocks a build. */
function gateAgainstThresholdsNRuns(cases, passRates) {
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  const reliable = cases.filter((c) => passRates.get(c.id).passRate >= thresholds.model.perCase);
  const overall = cases.length ? reliable.length / cases.length : 0;
  console.log(
    `\nReliable cases (pass-rate >= ${pct(thresholds.model.perCase)}): ${reliable.length}/${cases.length} (${pct(overall)})`
  );
  if (overall < thresholds.model.overall) {
    console.error(
      `\nFAIL: ${pct(overall)} of cases are reliable, below the ${pct(thresholds.model.overall)} threshold ` +
        `in ${path.relative(REPO_ROOT, THRESHOLDS_PATH)}.`
    );
    return { passed: false, reliable: reliable.length, total: cases.length, overall };
  }
  console.log(`\nPASS — at or above the ${pct(thresholds.model.overall)} threshold.`);
  return { passed: true, reliable: reliable.length, total: cases.length, overall };
}

function main() {
  runCheckSync();
  const { engine, n } = parseArgs(process.argv.slice(2));
  const cases = loadCases();

  if (n > 1 && engine !== 'heuristic') {
    runNTimes(engine, n, cases);
    return;
  }

  const results = runEngine(engine);
  const resultsById = new Map(results.map((r) => [r.id, r]));

  if (results.every((r) => r.status === 'skipped')) {
    const reason = results[0]?.reason ?? 'skipped';
    console.log(`eval (${engine}): skipped — ${reason}`);
    emitResult(engine, { mode: 'skipped', samples: 1, status: 'skipped', reason, command: commandFor(engine, 1) });
    process.exit(0);
  }

  const report = aggregate(cases, { [engine]: results })[engine];
  console.log(`eval (${engine}): ${cases.length} cases`);
  printAxisTable(cases, resultsById);
  printFieldTable(report);
  console.log(
    `\nOverall: ${report.counts.overallCorrect}/${report.counts.overallTotal} (${pct(report.overallAccuracy)})` +
      `   Fail-to-parse: ${report.counts.failToParseCorrect}/${report.counts.failToParseTotal} (${pct(report.failToParseAccuracy)})`
  );
  if (report.errors.length > 0) {
    console.log(`\n${report.errors.length} case(s) errored:`);
    for (const e of report.errors) console.log(`  ${e.id}: ${e.error}`);
  }

  const passed =
    engine === 'heuristic'
      ? gateAgainstBaseline(cases, resultsById, report)
      : gateAgainstThresholds(report);

  emitResult(engine, {
    // `mode` discriminates the two committed-artifact shapes (review nit #2):
    // 'single-sample' carries `overall` + `fields`; 'pass-rate' (below) carries
    // `passRate` instead. A consumer branches on `mode`, not on which keys exist.
    mode: 'single-sample',
    samples: 1,
    status: 'ok',
    command: commandFor(engine, 1),
    gate: {
      type: engine === 'heuristic' ? 'baseline' : 'thresholds',
      file: engine === 'heuristic' ? 'evals/baseline.json' : 'evals/thresholds.json',
      passed,
    },
    ...scorePayloadFromReport(report),
  });
  process.exit(passed ? 0 : 1);
}

/** Human-readable command string recorded in the artifact for reproducibility. */
function commandFor(engine, n) {
  if (engine === 'heuristic') return 'npm run eval';
  if (engine === 'anthropic') return 'npm run eval:cloud';
  if (engine === 'openai') return 'npm run eval:openai';
  if (engine === 'fm') return `FM_PROBE_PATH=$PWD/evals/fm/probe node evals/run-eval.mjs --engine=fm --n=${n}`;
  return `node evals/run-eval.mjs --engine=${engine}${n > 1 ? ` --n=${n}` : ''}`;
}

/** N-repeat path for a model-tier engine (`fm`/`anthropic`) — see the module
 *  doc's `--n=<N>` section. Skips cleanly (exit 0) on the first run if the
 *  engine is entirely unconfigured, same as the single-run path, before
 *  paying for N-1 more runs. */
function runNTimes(engine, n, cases) {
  const firstRun = runEngine(engine);
  if (firstRun.every((r) => r.status === 'skipped')) {
    const reason = firstRun[0]?.reason ?? 'skipped';
    console.log(`eval (${engine}, N=${n}): skipped — ${reason}`);
    emitResult(engine, { mode: 'skipped', samples: n, status: 'skipped', reason, command: commandFor(engine, n) });
    process.exit(0);
  }

  const runs = [firstRun];
  for (let i = 1; i < n; i++) runs.push(runEngine(engine));

  console.log(`eval (${engine}, N=${n}): ${cases.length} cases x ${n} runs`);
  const passRates = computePassRates(cases, runs);
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  printPassRateTable(cases, passRates, thresholds.model.perCase);
  const gate = gateAgainstThresholdsNRuns(cases, passRates);

  emitResult(engine, {
    mode: 'pass-rate',
    samples: n,
    status: 'ok',
    command: commandFor(engine, n),
    passRate: { reliable: gate.reliable, total: gate.total, accuracy: gate.overall },
    perCaseThreshold: thresholds.model.perCase,
    gate: { type: 'thresholds', file: 'evals/thresholds.json', passed: gate.passed },
  });
  process.exit(gate.passed ? 0 : 1);
}

function gateAgainstBaseline(cases, resultsById, report) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const currentPassing = new Set(
    cases.filter((c) => casePassed(c, resultsById.get(c.id))).map((c) => c.id)
  );

  let failed = false;
  const overall = report.overallAccuracy ?? 0;
  if (overall < baseline.overallAccuracy) {
    console.error(
      `\nFAIL: heuristic overall accuracy ${pct(overall)} dropped below baseline ${pct(baseline.overallAccuracy)}.`
    );
    failed = true;
  }

  const regressed = (baseline.passingCaseIds ?? []).filter((id) => !currentPassing.has(id));
  if (regressed.length > 0) {
    console.error(`\nFAIL: ${regressed.length} case(s) passing at baseline now fail:`);
    for (const id of regressed) console.error(`  ${id}`);
    failed = true;
  }

  if (failed) {
    console.error(
      `\nBaseline: ${path.relative(REPO_ROOT, BASELINE_PATH)} — update it deliberately if this` +
        ` regression is expected (e.g. a hand-labeled dataset fix), never to silence a real one.`
    );
    return false;
  }
  console.log(`\nPASS — at or above baseline (${pct(baseline.overallAccuracy)}), no case regressed.`);
  return true;
}

function gateAgainstThresholds(report) {
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  const overall = report.overallAccuracy ?? 0;
  if (overall < thresholds.model.overall) {
    console.error(
      `\nFAIL: ${pct(overall)} overall accuracy is below the ${pct(thresholds.model.overall)} threshold ` +
        `in ${path.relative(REPO_ROOT, THRESHOLDS_PATH)}.`
    );
    return false;
  }
  console.log(`\nPASS — at or above the ${pct(thresholds.model.overall)} threshold.`);
  return true;
}

main();
