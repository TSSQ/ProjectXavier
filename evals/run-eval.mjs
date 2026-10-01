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
 *   node evals/run-eval.mjs --split=dev          # only dataset.jsonl's "split": "dev" cases
 *   node evals/run-eval.mjs --split=holdout      # only "split": "holdout" cases — see
 *                                                 # evals/README.md's holdout-discipline note
 *                                                 # before running this against anything but
 *                                                 # a final, already-decided candidate.
 *
 * `--split=dev|holdout|all` (default `all`, i.e. every case — the behavior
 * before the split existed) filters `evals/dataset.jsonl`'s cases BEFORE
 * either scoring or running the engine: the filtered set is written to a
 * throwaway temp JSONL file and that's what's handed to
 * `evals/engines/run_node.mjs`, so an expensive engine (`fm`, in particular)
 * is never invoked on a case outside the requested split. The resolved split
 * is recorded on the committed artifact as `datasetSplit` and folded into
 * `command` for reproducibility.
 *
 * Gating:
 *   - `heuristic` (the default, no-key tier): exits non-zero if overall
 *     accuracy drops below the committed `evals/baseline.json`, or if any
 *     case that passed at baseline now fails.
 *   - any other engine (the model tiers, `anthropic`/`fm`): if no key/probe is
 *     configured, the underlying runner reports every case `skipped` — this
 *     script then prints `skipped` and exits 0 (never blocks a build on a
 *     missing BYOK key or an FM-incapable machine). With a key/probe present,
 *     it grades against `evals/thresholds.json` instead of the baseline file
 *     — SEPARATELY on parse-case accuracy (`thresholds.model.parse`, 0.80)
 *     and refusal-case accuracy (`thresholds.model.refusal`, 0.85) rather
 *     than one blended `overall` bar (review S2): 7 of the dataset's 39 cases
 *     are refusals the model reliably gets right, so a single blended average
 *     could stay above 0.80 even when parse-case accuracy alone was well
 *     below it. Both populations must individually clear their own bar.
 *   - `--n=<N>` (model tiers only; default 1): both `fm` and `anthropic` are
 *     nondeterministic, so `/build`'s preflight repeats every case N=5 times
 *     and gates on PASS-RATE (the fraction of runs where a case scored
 *     correct) rather than a single sample — `thresholds.model.perCase` is
 *     the bar an individual case's pass-rate must clear to count as
 *     "reliable"; the fraction of RELIABLE parse cases and the fraction of
 *     RELIABLE refusal cases are then each gated against
 *     `thresholds.model.parse`/`thresholds.model.refusal`, same split as the
 *     single-sample gate above. `--n=1` (the default) is exactly the
 *     original single-sample behavior, unchanged.
 *
 * With ~39 cases (32 parse-case, 7 refusal-case) a swing of ±1–2 cases moves
 * either population's accuracy by several points — treat a small change as
 * noise, not signal, unless it repeats across runs or moves a case that was
 * previously reliably passing.
 *
 * Every invocation (any engine) also runs, in order, before any scoring:
 *   1. `evals/fm/check-sync.mjs` — confirms the Swift probe's vendored
 *      `AppleLLMSchemaParser` hasn't drifted from the installed
 *      `@react-native-ai/apple` binding's copy (no FM, no Swift compile
 *      needed for this check itself).
 *   2. `evals/test-score.mjs` — the scorer's own unit tests.
 *   3. `evals/test-score-parity.mjs` (review S4) — a differential test
 *      proving `score.mjs` and `scoring.py` agree on the same fixture (skips
 *      cleanly without a Python venv).
 * A failure in any of the three fails the whole `npm run eval` invocation
 * before a single real case is scored — a broken guard/scorer must never
 * silently produce a passing gate.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from './score.mjs';
// Pure(ish) gate/scoring helpers (review N5) — see evals/gates.mjs's own doc
// comment and evals/test-gates.mjs for their unit tests.
import {
  pct,
  casePassed,
  buildCaseDiagnostics,
  sumOrderUnavailable,
  computePassRates,
  gateAgainstThresholds,
  gateAgainstThresholdsNRuns,
  isRepoDirty,
  isArtifactUnchanged,
} from './gates.mjs';

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
const TEST_SCORE_PATH = path.join(__dirname, 'test-score.mjs');
const TEST_SCORE_PARITY_PATH = path.join(__dirname, 'test-score-parity.mjs');
const TEST_GATES_PATH = path.join(__dirname, 'test-gates.mjs');
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

/** macOS `sw_vers` ProductVersion/BuildVersion + the installed
 *  `@react-native-ai/apple` binding version (review N4) — the machine/binding
 *  an `fm` run's numbers actually depended on. Each sub-field independently
 *  falls back to `'unknown'` rather than failing the whole run: a
 *  provenance field must never turn a passing gate into a crash. */
function fmEnvironment() {
  const swVers = (arg) => {
    try {
      return execFileSync('sw_vers', [arg], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  let appleBindingVersion = 'unknown';
  try {
    appleBindingVersion = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'node_modules', '@react-native-ai', 'apple', 'package.json'), 'utf8')
    ).version;
  } catch {
    // Not installed / unreadable — 'unknown' stands.
  }
  return {
    macOSProductVersion: swVers('-productVersion'),
    macOSBuildVersion: swVers('-buildVersion'),
    appleBindingVersion,
  };
}

/** Model identifier recorded in the artifact, matching what the engine ran. */
function engineModel(engine) {
  if (engine === 'anthropic') return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  if (engine === 'fm') return 'apple-foundation-models (on-device)';
  if (engine === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return 'localParse (heuristic, src/domain/localParse.ts)';
}

/** Write evals/results/<engine>.json. `generatedAt` is a wall-clock ISO
 *  string — fine here (this is a normal CLI, not a resumable workflow).
 *
 *  ARTIFACT CHURN (review S7): if a re-run produces a result identical to
 *  the already-committed file in every field EXCEPT `gitSha`/`generatedAt`
 *  (the two fields that trivially change on every run regardless of whether
 *  anything about the SCORE did), the file is left untouched rather than
 *  rewritten — so `git diff` on a clean re-run of an unrelated change stays
 *  empty instead of showing a no-op timestamp/SHA bump. */
function emitResult(engine, payload) {
  // A provenance-write failure must NEVER change the gate's exit code (review
  // nit #4): if evals/results/ is unwritable, warn and carry on with the
  // already-computed pass/fail rather than throwing an uncaught exception that
  // would surface a passing gate as a spurious non-zero (a false build block).
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = path.join(RESULTS_DIR, `${engine}.json`);
    const out = {
      engine,
      model: engineModel(engine),
      gitSha: gitSha(),
      generatedAt: new Date().toISOString(),
      dirty: isRepoDirty(REPO_ROOT),
      datasetFile: 'evals/dataset.jsonl',
      metric:
        'Per case: amountMinor/sign/dateISO are scored on every case; category/payee only when the case\'s label asserts them (see evals/scoring.py). ' +
        '"overall" spans every case in the dataset — both parse cases (a real expense) and refusal cases (expected: null) — with a refusal case counted correct on a null return; "parseCases"/"failToParse" split that same population back out, and "perAxis" breaks it down further by dataset axis.',
      // Review N4 — the machine/binding this run's numbers actually depended
      // on, ONLY for the `fm` engine (the other tiers don't touch Foundation
      // Models). Participates in the no-op-rewrite comparison the same way
      // `dirty` already does (it's a normal field of `out`, not stripped by
      // `isArtifactUnchanged`): a re-run on the SAME macOS build + binding
      // version stays a no-op if nothing else changed either, but a real
      // change here (an OS update, a binding bump) is never silently
      // swallowed into an unchanged artifact.
      ...(engine === 'fm' ? { fmEnvironment: fmEnvironment() } : {}),
      ...payload,
    };

    let existing = null;
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch {
      existing = null;
    }
    if (isArtifactUnchanged(existing, out)) {
      console.log(
        `eval: ${path.relative(REPO_ROOT, outPath)} unchanged (only gitSha/generatedAt would differ) — not rewriting.`
      );
      return;
    }

    writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  } catch (e) {
    console.error(`eval: could not write ${engine} result artifact (non-fatal): ${e.message}`);
  }
}

/** Shape a report's scores into the committed-artifact schema.
 *
 * `overall` is the RECONCILED definition (see score.mjs's aggregate() doc
 * comment): scored over ALL cases, a refusal case counted correct on a null
 * return — the same population the `--n`-repeat pass-rate gate has always
 * used. `parseCases`/`failToParse` split that same population back out
 * (asserted-expense cases vs. fail-to-parse cases) for diagnosability;
 * `perAxis` breaks it down further by dataset axis. */
function scorePayloadFromReport(report) {
  return {
    overall: {
      correct: report.counts.overallCorrect,
      total: report.counts.overallTotal,
      accuracy: report.overallAccuracy,
    },
    parseCases: {
      correct: report.counts.parseCorrect,
      total: report.counts.parseTotal,
      accuracy: report.parseAccuracy,
    },
    failToParse: {
      correct: report.counts.failToParseCorrect,
      total: report.counts.failToParseTotal,
      accuracy: report.failToParseAccuracy,
    },
    perAxis: report.axisAccuracy,
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

/** Run the scorer's own unit tests (evals/test-score.mjs), the gate/scoring
 *  helpers' own unit tests (evals/test-gates.mjs, review N5), and the
 *  JS<->Python scorer-lockstep differential test (evals/test-score-parity.mjs,
 *  review S4) as subprocesses, before any real scoring runs — a broken
 *  scorer/gate must never silently produce a passing gate. The parity test
 *  skips itself (exit 0) when evals/.venv doesn't exist, so this never
 *  requires a Python venv (see evals/README.md — that means it only actually
 *  guards LOCAL runs, not CI). */
function runScorerSelfTests() {
  for (const scriptPath of [TEST_SCORE_PATH, TEST_GATES_PATH, TEST_SCORE_PARITY_PATH]) {
    try {
      execFileSync('node', [scriptPath], { stdio: 'inherit', cwd: REPO_ROOT });
    } catch {
      console.error(`\neval: ${path.relative(REPO_ROOT, scriptPath)} failed — see above.`);
      process.exit(1);
    }
  }
}

const VALID_SPLITS = new Set(['dev', 'holdout', 'all']);

function parseArgs(argv) {
  let engine = 'heuristic';
  let n = 1;
  let split = 'all';
  for (const arg of argv) {
    if (arg.startsWith('--engine=')) engine = arg.slice('--engine='.length);
    if (arg.startsWith('--n=')) n = Number(arg.slice('--n='.length));
    if (arg.startsWith('--split=')) split = arg.slice('--split='.length);
  }
  if (!Number.isInteger(n) || n < 1) n = 1;
  if (!VALID_SPLITS.has(split)) {
    console.error(`eval: --split must be one of dev|holdout|all (got "${split}")`);
    process.exit(1);
  }
  return { engine, n, split };
}

/** Loads the full dataset, optionally filtered to one `split` ('dev' |
 *  'holdout' | 'all' — default 'all', matching the dataset before the split
 *  existed). A case with no `split` field at all (shouldn't happen post
 *  evals/split.mjs, but never crash a gate on a malformed row) only matches
 *  'all'. */
function loadCases(split = 'all') {
  const all = readFileSync(DATASET_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (split === 'all') return all;
  return all.filter((c) => c.split === split);
}

/** Shell out to the REAL engine runner (never re-implemented here) and parse
 *  its JSON stdout. `cases` is the (already split-filtered) case list to run
 *  — written to a throwaway temp JSONL file so the engine runner never has to
 *  know about splits, and so an expensive engine (fm, in particular) is never
 *  run against cases outside the requested split. */
function runEngine(engine, cases) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'xavier-eval-'));
  const tmpDatasetPath = path.join(tmpDir, 'dataset.jsonl');
  try {
    writeFileSync(tmpDatasetPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
    const stdout = execFileSync(
      'npx',
      ['tsx', path.join(__dirname, 'engines', 'run_node.mjs'), engine, tmpDatasetPath],
      { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Warns on stdout (review S4 — "warn at run level") when ANY probe attempt
 *  across the whole run couldn't extract a schema property order at all
 *  (`orderUnavailable`, summed via `sumOrderUnavailable`) — a silent
 *  extraction failure would otherwise just show up as a smaller-than-
 *  expected `fieldOrders`/`attemptsDetail` array buried in a case's
 *  diagnostics, easy to miss. A no-op for non-`fm` engines/single-sample
 *  runs with no diagnostics at all (sums to 0). */
function warnOnOrderUnavailable(caseDiagnostics) {
  const total = sumOrderUnavailable(caseDiagnostics);
  if (total > 0) {
    console.warn(
      `\nWARNING: ${total} probe attempt(s) across this run logged no extractable schema property ` +
        `order ("schema property order UNAVAILABLE:" — see probe.swift's logGenerationSchemaPropertyOrder). ` +
        `Recorded as the artifact's top-level "orderUnavailable".`
    );
  }
}

/** Prints `report.axisAccuracy` (score.mjs's aggregate() — ALL cases, a
 *  refusal case correct on a null return), rather than recomputing it here,
 *  so the console table and the committed artifact's `perAxis` always agree. */
function printAxisTable(axisAccuracy) {
  console.log('\nPer-axis accuracy:');
  for (const [axis, { correct, total }] of Object.entries(axisAccuracy)) {
    console.log(`  ${axis.padEnd(18)} ${correct}/${total}  (${pct(correct / total)})`);
  }
}

/** Prints `thresholds.targets` (evals/thresholds.json — a NON-gating "good
 *  enough to be the default" bar, see evals/README.md's "Good enough" bar
 *  section) alongside the actual numbers for a model-tier engine run. Never
 *  affects the exit code — purely informational, same report shape for both
 *  the single-sample and `--n`-repeat (pass-rate) run modes. `actual` is
 *  `{ parse, refusal, amountMinor, sign }`, each `number|null` (null -> n/a,
 *  e.g. an empty population). */
function printTargetsTable(targets, actual) {
  if (!targets) return;
  console.log('\nTargets ("good enough to replace BYOK" bar — not gated):');
  for (const key of ['parse', 'refusal', 'amountMinor', 'sign']) {
    if (targets[key] == null) continue;
    const got = actual[key];
    const flag = got != null && got >= targets[key] ? 'MEETS' : 'below';
    console.log(`  ${key.padEnd(12)} ${pct(got)}  vs target ${pct(targets[key])}  (${flag})`);
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

function printPassRateTable(cases, passRates, perCaseThreshold) {
  console.log(`\nPer-case pass-rate (N=${cases.length ? [...passRates.values()][0].total : 0}):`);
  for (const c of cases) {
    const { passes, total, passRate } = passRates.get(c.id);
    const flag = passRate >= perCaseThreshold ? ' ' : ' *';
    console.log(`  ${c.id.padEnd(24)} ${passes}/${total}  (${pct(passRate)})${flag}`);
  }
  console.log(`  (* below the ${pct(perCaseThreshold)} per-case threshold)`);
}

/** Per-axis and parse-cases/refusal-cases reliability breakdown for the
 *  `--n`-repeat mode, mirroring `score.mjs`'s `axisAccuracy`/`parseAccuracy`/
 *  `failToParseAccuracy` split — but over pass-RATE reliability (a case
 *  counts iff its pass-rate clears `perCaseThreshold`) rather than a single
 *  sample's correctness. */
function computeAxisReliability(cases, passRates, perCaseThreshold) {
  const byAxis = new Map();
  for (const c of cases) {
    const entry = byAxis.get(c.axis) ?? { reliable: 0, total: 0 };
    entry.total += 1;
    if (passRates.get(c.id).passRate >= perCaseThreshold) entry.reliable += 1;
    byAxis.set(c.axis, entry);
  }
  return Object.fromEntries(
    [...byAxis.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([axis, { reliable, total }]) => [axis, { reliable, total, rate: reliable / total }])
  );
}

function main() {
  runCheckSync();
  runScorerSelfTests();
  const { engine, n, split: datasetSplit } = parseArgs(process.argv.slice(2));
  const cases = loadCases(datasetSplit);

  if (n > 1 && engine !== 'heuristic') {
    runNTimes(engine, n, cases, datasetSplit);
    return;
  }

  const results = runEngine(engine, cases);
  const resultsById = new Map(results.map((r) => [r.id, r]));

  if (results.every((r) => r.status === 'skipped')) {
    const reason = results[0]?.reason ?? 'skipped';
    console.log(`eval (${engine}): skipped — ${reason}`);
    emitResult(engine, {
      mode: 'skipped',
      samples: 1,
      status: 'skipped',
      reason,
      datasetSplit,
      command: commandFor(engine, 1, datasetSplit),
    });
    process.exit(0);
  }

  const report = aggregate(cases, { [engine]: results })[engine];
  console.log(`eval (${engine}, split=${datasetSplit}): ${cases.length} cases`);
  printAxisTable(report.axisAccuracy);
  printFieldTable(report);
  console.log(
    `\nOverall (all ${report.counts.overallTotal} cases): ${report.counts.overallCorrect}/${report.counts.overallTotal} (${pct(report.overallAccuracy)})` +
      `\n  Parse cases: ${report.counts.parseCorrect}/${report.counts.parseTotal} (${pct(report.parseAccuracy)})` +
      `   Refusal cases: ${report.counts.failToParseCorrect}/${report.counts.failToParseTotal} (${pct(report.failToParseAccuracy)})`
  );
  if (report.errors.length > 0) {
    console.log(`\n${report.errors.length} case(s) errored:`);
    for (const e of report.errors) console.log(`  ${e.id}: ${e.error}`);
  }

  if (engine !== 'heuristic') {
    const { targets } = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
    printTargetsTable(targets, {
      parse: report.parseAccuracy,
      refusal: report.failToParseAccuracy,
      amountMinor: report.fieldAccuracy.amountMinor,
      sign: report.fieldAccuracy.sign,
    });
  }

  const passed =
    engine === 'heuristic'
      ? gateAgainstBaseline(cases, resultsById, report)
      : gateAgainstThresholds(report, JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')));

  // Per-case diagnostics (id, axis, pass count, and — for a failing case —
  // which asserted fields were wrong, expected vs actual, plus per-sample
  // order/outcome pairing) so a red run is diagnosable straight from the
  // committed artifact.
  const caseDiagnostics = buildCaseDiagnostics(cases, [results]);
  warnOnOrderUnavailable(caseDiagnostics);

  emitResult(engine, {
    // `mode` discriminates the two committed-artifact shapes (review nit #2):
    // 'single-sample' carries `overall` + `fields`; 'pass-rate' (below) carries
    // `passRate` instead. A consumer branches on `mode`, not on which keys exist.
    mode: 'single-sample',
    samples: 1,
    status: 'ok',
    datasetSplit,
    command: commandFor(engine, 1, datasetSplit),
    gate: {
      type: engine === 'heuristic' ? 'baseline' : 'thresholds',
      file: engine === 'heuristic' ? 'evals/baseline.json' : 'evals/thresholds.json',
      passed,
    },
    ...scorePayloadFromReport(report),
    ...(engine !== 'heuristic'
      ? { targets: JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')).targets }
      : {}),
    ...(engine === 'fm' ? { orderUnavailable: sumOrderUnavailable(caseDiagnostics) } : {}),
    cases: caseDiagnostics,
  });
  process.exit(passed ? 0 : 1);
}

/** Human-readable command string recorded in the artifact for reproducibility.
 *  `datasetSplit` is only appended when it isn't the default 'all', so an
 *  unfiltered run's recorded command is unchanged from before `--split`
 *  existed. */
function commandFor(engine, n, datasetSplit = 'all') {
  const splitFlag = datasetSplit !== 'all' ? ` --split=${datasetSplit}` : '';
  if (engine === 'heuristic') return `npm run eval${splitFlag}`;
  if (engine === 'anthropic') return `npm run eval:cloud${splitFlag}`;
  if (engine === 'openai') return `npm run eval:openai${splitFlag}`;
  if (engine === 'fm') return `FM_PROBE_PATH=$PWD/evals/fm/probe node evals/run-eval.mjs --engine=fm --n=${n}${splitFlag}`;
  return `node evals/run-eval.mjs --engine=${engine}${n > 1 ? ` --n=${n}` : ''}${splitFlag}`;
}

/** N-repeat path for a model-tier engine (`fm`/`anthropic`) — see the module
 *  doc's `--n=<N>` section. Skips cleanly (exit 0) on the first run if the
 *  engine is entirely unconfigured, same as the single-run path, before
 *  paying for N-1 more runs. */
function runNTimes(engine, n, cases, datasetSplit) {
  const firstRun = runEngine(engine, cases);
  if (firstRun.every((r) => r.status === 'skipped')) {
    const reason = firstRun[0]?.reason ?? 'skipped';
    console.log(`eval (${engine}, N=${n}): skipped — ${reason}`);
    emitResult(engine, {
      mode: 'skipped',
      samples: n,
      status: 'skipped',
      reason,
      datasetSplit,
      command: commandFor(engine, n, datasetSplit),
    });
    process.exit(0);
  }

  const runs = [firstRun];
  for (let i = 1; i < n; i++) runs.push(runEngine(engine, cases));

  console.log(`eval (${engine}, N=${n}, split=${datasetSplit}): ${cases.length} cases x ${n} runs`);
  const passRates = computePassRates(cases, runs);
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  printPassRateTable(cases, passRates, thresholds.model.perCase);
  printAxisTable(
    Object.fromEntries(
      Object.entries(computeAxisReliability(cases, passRates, thresholds.model.perCase)).map(
        ([axis, { reliable, total }]) => [axis, { correct: reliable, total }]
      )
    )
  );
  const gate = gateAgainstThresholdsNRuns(cases, passRates, thresholds);
  const parseRefusalSplit = gate.split;

  // Per-field accuracy (amountMinor/sign, for the targets report below) is
  // computed from the FIRST run only — a single `aggregate()` pass, same
  // shape as the single-sample report. With the field order pinned, greedy
  // sampling makes every repeat byte-identical in principle (README's
  // "Field-order experiment"), so this is informational, not a second
  // (cheaper) gate — any case that differs across runs is already flagged
  // elsewhere (the per-case pass-rate table above, and a non-1.0/0.0
  // pass-rate in `cases`).
  const firstRunFieldAccuracy = aggregate(cases, { [engine]: runs[0] })[engine].fieldAccuracy;
  printTargetsTable(thresholds.targets, {
    parse: parseRefusalSplit.parseCases.rate,
    refusal: parseRefusalSplit.refusalCases.rate,
    amountMinor: firstRunFieldAccuracy.amountMinor,
    sign: firstRunFieldAccuracy.sign,
  });

  // Per-case diagnostics across all N samples — see buildCaseDiagnostics.
  const caseDiagnostics = buildCaseDiagnostics(cases, runs);
  warnOnOrderUnavailable(caseDiagnostics);

  emitResult(engine, {
    mode: 'pass-rate',
    samples: n,
    status: 'ok',
    datasetSplit,
    command: commandFor(engine, n, datasetSplit),
    // The reconciled all-cases fraction (see gateAgainstThresholdsNRuns's doc
    // comment) — reported as `passRate` (unchanged shape/meaning from before:
    // this mode's population was always ALL cases).
    passRate: { reliable: gate.reliable, total: gate.total, accuracy: gate.overall },
    // "parse cases" vs "refusal cases" split of that same reliable-fraction —
    // the pass-rate-mode analogue of the single-sample artifact's
    // `parseCases`/`failToParse`.
    parseCases: {
      correct: parseRefusalSplit.parseCases.reliable,
      total: parseRefusalSplit.parseCases.total,
      accuracy: parseRefusalSplit.parseCases.rate,
    },
    failToParse: {
      correct: parseRefusalSplit.refusalCases.reliable,
      total: parseRefusalSplit.refusalCases.total,
      accuracy: parseRefusalSplit.refusalCases.rate,
    },
    perAxis: computeAxisReliability(cases, passRates, thresholds.model.perCase),
    perCaseThreshold: thresholds.model.perCase,
    gate: { type: 'thresholds', file: 'evals/thresholds.json', passed: gate.passed },
    // Non-gating "good enough to replace BYOK" bar (evals/README.md) plus the
    // actuals it's compared against — see firstRunFieldAccuracy's own doc
    // comment above for why amountMinor/sign come from run 0 only.
    targets: thresholds.targets,
    fieldAccuracy: firstRunFieldAccuracy,
    ...(engine === 'fm' ? { orderUnavailable: sumOrderUnavailable(caseDiagnostics) } : {}),
    cases: caseDiagnostics,
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

main();
