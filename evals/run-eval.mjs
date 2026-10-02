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
 *   node evals/run-eval.mjs                 # heuristic engine, --split=dev (default) — no keys
 *   node evals/run-eval.mjs --engine=anthropic   # cloud engine — key-gated
 *   node evals/run-eval.mjs --engine=fm          # on-device model — FM_PROBE_PATH-gated
 *   node evals/run-eval.mjs --engine=fm --n=5    # repeat every case 5x, gate on pass-rate
 *   node evals/run-eval.mjs --split=all          # dev + holdout (v1); NOT holdout2
 *   node evals/run-eval.mjs --split=holdout --confirm-holdout --purpose="..."
 *                                                 # "holdout" cases ONLY — see
 *                                                 # evals/README.md's holdout-discipline note.
 *                                                 # REFUSES to run without BOTH flags (review
 *                                                 # B1) — `--split=all` needs them too, since it
 *                                                 # also touches every holdout case.
 *
 * `--split=dev|holdout|all` (review B1 — **default is now `dev`**, not
 * `all`: a routine invocation of this script, or any `npm run eval*` script,
 * never touches the holdout split unless asked to explicitly) filters
 * `evals/dataset.jsonl`'s cases BEFORE either scoring or running the engine:
 * the filtered set is written to a throwaway temp JSONL file and that's what's
 * handed to `evals/engines/run_node.mjs`, so an expensive engine (`fm`, in
 * particular) is never invoked on a case outside the requested split. The
 * resolved split is recorded on the committed artifact as `datasetSplit` and
 * folded into `command` for reproducibility. Accepts both `--split=dev` and
 * `--split dev` forms (review B3, via the shared `evals/split.mjs`'s
 * `parseSplitArg`); any unrecognized flag fails the whole invocation loudly
 * rather than being silently ignored.
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
 *   3. `evals/test-gates.mjs` — this file's own gate/scoring helpers' unit
 *      tests (`evals/gates.mjs`).
 *   4. `evals/test-score-parity.mjs` (review S4) — a differential test
 *      proving `score.mjs` and `scoring.py` agree on the same fixture (skips
 *      cleanly without a Python venv).
 *   5. `evals/test-split.mjs` — the dev/holdout split assignment's own unit
 *      tests (review M6).
 *   6. `node evals/split.mjs --check` (review M6) — every dataset case has a
 *      `split` and none has drifted from the append-only assignment.
 * A failure in any of the six fails the whole `npm run eval` invocation
 * before a single real case is scored — a broken guard/scorer/split must
 * never silently produce a passing gate.
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
  buildCaseDiagnostics,
  sumOrderUnavailable,
  computePassRates,
  gateAgainstThresholds,
  gateAgainstThresholdsNRuns,
  gateAgainstBaselineReport,
  computeExtendedMetrics,
  computeAfterRoutingRefusal,
  isRepoDirty,
  isArtifactUnchanged,
} from './gates.mjs';
// Shared split helpers (review B3) — the one definition of `VALID_SPLITS`/
// `parseSplitArg`/`loadCases(split)`, also used by evals/fm/replay-orders.mjs.
// `gitSha`/`guardAndLogHoldoutLook` moved here from this file by review X2
// — evals/fm/replay-orders.mjs needed the exact same holdout-look guard and
// previously had none at all.
import { parseSplitArg, loadCases, gitSha, guardAndLogHoldoutLook } from './split.mjs';
import { commandFor } from './command.mjs';

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
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');
const CHECK_SYNC_PATH = path.join(__dirname, 'fm', 'check-sync.mjs');
const TEST_SCORE_PATH = path.join(__dirname, 'test-score.mjs');
const TEST_SCORE_PARITY_PATH = path.join(__dirname, 'test-score-parity.mjs');
const TEST_GATES_PATH = path.join(__dirname, 'test-gates.mjs');
const TEST_SPLIT_PATH = path.join(__dirname, 'test-split.mjs');
const TEST_DATASET_SCHEMA_PATH = path.join(__dirname, 'test-dataset-schema.mjs');
const SPLIT_PATH = path.join(__dirname, 'split.mjs');
// Review Major 3 — the real app's `detectIntent` routing decision for the
// "refusal after intent routing" figure (non-gating; see
// `computeAfterRoutingRefusal` in gates.mjs and `getRoutedIds` below).
const INTENT_ROUTING_PATH = path.join(__dirname, 'fm', 'intent-routing.mjs');
// Committed per-run provenance artifacts (evals/results/<engine>.json) — a
// durable, machine-readable record of the last run of each engine (scores,
// git SHA, timestamp, gate outcome). Committed on purpose so a repo reader can
// trace "what did the eval say" without re-running it or needing a key/FM;
// contains only scores + metadata, never a key or any dataset PII.
const RESULTS_DIR = path.join(__dirname, 'results');

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
    // Review M4 — a non-'all' run must never overwrite the canonical
    // artifact: 'dev'/'holdout' runs get their own `<engine>.<split>.json`
    // file, so a routine (now default) dev run can't clobber the committed
    // `<engine>.json` that documents the one full-dataset ('all') run a
    // reader expects to find there. Only an explicit `--split=all` run
    // writes the canonical, suffix-less path.
    const splitSuffix = payload.datasetSplit && payload.datasetSplit !== 'all' ? `.${payload.datasetSplit}` : '';
    const outPath = path.join(RESULTS_DIR, `${engine}${splitSuffix}.json`);
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
 *  guards LOCAL runs, not CI). Also runs `evals/test-split.mjs` (the split
 *  assignment's own unit tests) and `node evals/split.mjs --check` (review
 *  M6) — so `npm run eval` enforces that every dataset case has a `split`
 *  and that the committed split hasn't drifted, the same way it already
 *  enforces the scorer/gate self-tests. */
function runScorerSelfTests() {
  for (const scriptPath of [
    TEST_SCORE_PATH,
    TEST_GATES_PATH,
    TEST_SCORE_PARITY_PATH,
    TEST_SPLIT_PATH,
    TEST_DATASET_SCHEMA_PATH,
  ]) {
    try {
      execFileSync('node', [scriptPath], { stdio: 'inherit', cwd: REPO_ROOT });
    } catch {
      console.error(`\neval: ${path.relative(REPO_ROOT, scriptPath)} failed — see above.`);
      process.exit(1);
    }
  }
  try {
    execFileSync('node', [SPLIT_PATH, '--check'], { stdio: 'inherit', cwd: REPO_ROOT });
  } catch {
    console.error('\neval: split check failed — see above.');
    process.exit(1);
  }
}

/** Strict flag parsing (review B3): accepts `--engine=x`, `--n=N`,
 *  `--split=x`/`--split x` (via the shared `parseSplitArg`), `--confirm-
 *  holdout`, and `--purpose=...` — ANYTHING else fails loudly instead of
 *  being silently ignored (previously `--split dev`, a typo'd flag, etc.
 *  just fell through to the defaults with no warning). Default split is now
 *  `'dev'` (review B1) — a bare `node evals/run-eval.mjs` (or `npm run
 *  eval`/`eval:cloud`/`eval:fm`) no longer touches the holdout split unless
 *  `--split=holdout` is given explicitly (and, for holdout specifically,
 *  `--confirm-holdout` too — see `main()`). */
function parseArgs(argv) {
  let engine = 'heuristic';
  let n = 1;
  let confirmHoldout = false;
  let purpose = null;
  let split, rest;
  try {
    ({ split, rest } = parseSplitArg(argv, { default: 'dev' }));
  } catch (e) {
    console.error(`eval: ${e.message}`);
    process.exit(1);
  }

  const unknown = [];
  let rawN = null;
  for (const arg of rest) {
    if (arg.startsWith('--engine=')) engine = arg.slice('--engine='.length);
    else if (arg.startsWith('--n=')) rawN = arg.slice('--n='.length);
    else if (arg === '--confirm-holdout') confirmHoldout = true;
    else if (arg.startsWith('--purpose=')) purpose = arg.slice('--purpose='.length);
    else unknown.push(arg);
  }
  if (unknown.length > 0) {
    console.error(`eval: unknown flag(s): ${unknown.join(', ')}`);
    process.exit(1);
  }
  // Review nit — `--n=foo`/`--n=0`/`--n=-1` used to silently coerce to 1
  // (`!Number.isInteger(n) || n < 1` just overwrote it), masking a typo as
  // a normal single-sample run instead of failing loudly. Only a genuinely
  // absent `--n` keeps the default of 1; anything present but not a
  // positive integer is now a hard error.
  if (rawN != null) {
    n = Number(rawN);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`eval: --n must be a positive integer (got "${rawN}")`);
      process.exit(1);
    }
  }
  return { engine, n, split, confirmHoldout, purpose };
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

/** I/O wrapper (review Major 3) around the real app's `detectIntent`
 *  (`src/domain/intentGate.ts`, via the `evals/fm/intent-routing.mjs`
 *  subprocess — see that file's own doc comment for why this has to be a
 *  subprocess) — returns a `Set<string>` of case ids among `cases`' refusal
 *  (`expected == null`) population that the real app routes away from the
 *  parser entirely. Only the refusal cases are ever written to the
 *  subprocess's input (there's nothing to route-check about a parse case —
 *  `computeAfterRoutingRefusal` only looks at refusal cases anyway), and an
 *  empty refusal population short-circuits without spawning a subprocess at
 *  all. Never throws on its own — a routing-helper fault must not crash an
 *  otherwise-successful eval run over a purely informational figure; it
 *  logs a warning and returns an empty set (equivalent to "nothing routed",
 *  which only makes the reported figure MORE conservative, never inflates
 *  it). */
function getRoutedIds(cases) {
  const refusalCases = cases.filter((c) => c.expected == null);
  if (refusalCases.length === 0) return new Set();
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'xavier-eval-routing-'));
  const tmpPath = path.join(tmpDir, 'refusal-cases.jsonl');
  try {
    writeFileSync(tmpPath, refusalCases.map((c) => JSON.stringify(c)).join('\n') + '\n');
    const stdout = execFileSync('npx', ['tsx', INTENT_ROUTING_PATH, tmpPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const routed = JSON.parse(stdout);
    return new Set(routed.filter((r) => r.routed).map((r) => r.id));
  } catch (e) {
    console.warn(`\nWARNING: could not compute "refusal after intent routing" (non-fatal): ${e.message}`);
    return new Set();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Prints the non-gating "refusal after intent routing" figure (review
 *  Major 3) — see `computeAfterRoutingRefusal`'s own doc comment (gates.mjs)
 *  for the full contract. A no-op when there were no refusal cases in this
 *  run's split at all (`result.total + result.routed === 0`). */
function printAfterRoutingRefusal(result) {
  if (result.total + result.routed === 0) return;
  console.log(
    `\nRefusal after intent routing (non-gating — reported only, see evals/README.md): ` +
      `${result.correct}/${result.total} (${pct(result.rate)}) among the ${result.total} refusal case(s) ` +
      `the real app's detectIntent does NOT route away; ${result.routed} more routed to a different ` +
      `handler before the parser, excluded from this figure entirely.`
  );
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
 *  section, restructured by step 1b.1's M3) alongside the actual numbers for
 *  a model-tier engine run. Never affects the exit code — purely
 *  informational, same report shape for both the single-sample and
 *  `--n`-repeat (pass-rate) run modes. `actual` is `{ parse, refusal,
 *  amountMinor, ledgerCorrect, recall: { income, transfer } }`, each
 *  `number|null` (null -> n/a, e.g. an empty population). */
function printTargetsTable(targets, actual) {
  if (!targets) return;
  console.log('\nTargets ("good enough to replace BYOK" bar — not gated):');
  const flagFor = (got, target) => (got != null && got >= target ? 'MEETS' : 'below');
  for (const key of ['ledgerCorrect', 'parse', 'amountMinor', 'refusal']) {
    if (targets[key] == null) continue;
    const got = actual[key];
    console.log(`  ${key.padEnd(16)} ${pct(got)}  vs target ${pct(targets[key])}  (${flagFor(got, targets[key])})`);
  }
  if (targets.recall) {
    for (const cls of ['income', 'transfer']) {
      if (targets.recall[cls] == null) continue;
      const got = actual.recall?.[cls];
      console.log(
        `  recall.${cls.padEnd(9)} ${pct(got)}  vs target ${pct(targets.recall[cls])}  (${flagFor(got, targets.recall[cls])})`
      );
    }
  }
  printRelativeBar(targets.relativeToByok);
}

/** Prints the non-gating relative "replace BYOK" bar from `thresholds.json`'s
 *  `targets.relativeToByok` (README "BYOK reference run"). Informational text
 *  only: the BYOK reference must be re-measured on holdout v2 at N>=3, so
 *  there is no committed number to compare against yet. */
function printRelativeBar(rel) {
  if (!rel) return;
  console.log(
    `  relative bar     ledgerCorrect within ${rel.ledgerCorrectGapPoints} points of BYOK; ` +
      `refusal <= BYOK misses + ${rel.refusalMaxExtraMissesVsByok}; ` +
      `transfer recall <= BYOK misses + ${rel.transferRecallMaxExtraMissesVsByok}`
  );
  console.log(`                   reference: ${rel.reference}`);
}

/** Prints the M3 grouped-strata floors (`evals/gates.mjs`'s `STRATA`) and
 *  the per-axis target-field breakdown — each reported on its own target
 *  field, never gated (same "good enough" bar, see printTargetsTable's doc
 *  comment). `extended` is `computeExtendedMetrics`'s return value. */
function printStrataTable(extended) {
  console.log('\nGrouped-strata floors (reported on each stratum\'s own target field):');
  for (const [name, { field, correct, total, rate }] of Object.entries(extended.strata)) {
    console.log(`  ${name.padEnd(14)} (${field.padEnd(11)}) ${pct(rate)}  (${correct}/${total})`);
  }
  console.log('\nPer-axis accuracy on its own target field:');
  for (const [axis, { field, correct, total, rate }] of Object.entries(extended.perAxisTargetField)) {
    console.log(`  ${axis.padEnd(24)} (${field.padEnd(11)}) ${pct(rate)}  (${correct}/${total})`);
  }
  // Review Major 2 — previously only worked out by hand in evals/README.md;
  // now computed by `computeRefusalSubtypeBreakdown` (evals/gates.mjs) and
  // printed/recorded every run, so it can never silently drift from the
  // artifact it describes.
  if (extended.refusalBySubtype && Object.keys(extended.refusalBySubtype).length > 0) {
    console.log('\nPer refusal subtype:');
    for (const [subtype, { correct, total, rate }] of Object.entries(extended.refusalBySubtype)) {
      console.log(`  ${subtype.padEnd(20)} ${pct(rate)}  (${correct}/${total})`);
    }
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
  const { engine, n, split: datasetSplit, confirmHoldout, purpose } = parseArgs(process.argv.slice(2));
  guardAndLogHoldoutLook({
    split: datasetSplit,
    confirmHoldout,
    purpose,
    engine,
    command: commandFor(engine, n, datasetSplit, { purpose }),
  });
  const cases = loadCases(datasetSplit);

  if (n > 1 && engine !== 'heuristic') {
    runNTimes(engine, n, cases, datasetSplit, purpose);
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
      command: commandFor(engine, 1, datasetSplit, { purpose }),
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

  let extendedMetrics = null;
  let afterRoutingRefusal = null;
  if (engine !== 'heuristic') {
    const { targets } = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
    extendedMetrics = computeExtendedMetrics(cases, results);
    printTargetsTable(targets, {
      parse: report.parseAccuracy,
      refusal: report.failToParseAccuracy,
      amountMinor: report.fieldAccuracy.amountMinor,
      ledgerCorrect: extendedMetrics.ledgerCorrect.rate,
      recall: { income: extendedMetrics.recall.income.rate, transfer: extendedMetrics.recall.transfer.rate },
    });
    printStrataTable(extendedMetrics);
    afterRoutingRefusal = computeAfterRoutingRefusal(cases, resultsById, getRoutedIds(cases));
    printAfterRoutingRefusal(afterRoutingRefusal);
  }

  const passed =
    engine === 'heuristic'
      ? gateAgainstBaseline(cases, resultsById, report, datasetSplit)
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
    command: commandFor(engine, 1, datasetSplit, { purpose }),
    gate: {
      type: engine === 'heuristic' ? 'baseline' : 'thresholds',
      file: engine === 'heuristic' ? 'evals/baseline.json' : 'evals/thresholds.json',
      passed,
    },
    ...scorePayloadFromReport(report),
    ...(engine !== 'heuristic'
      ? {
          targets: JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')).targets,
          extendedMetrics,
          afterRoutingRefusal,
        }
      : {}),
    ...(engine === 'fm' ? { orderUnavailable: sumOrderUnavailable(caseDiagnostics) } : {}),
    cases: caseDiagnostics,
  });
  process.exit(passed ? 0 : 1);
}

/** N-repeat path for a model-tier engine (`fm`/`anthropic`) — see the module
 *  doc's `--n=<N>` section. Skips cleanly (exit 0) on the first run if the
 *  engine is entirely unconfigured, same as the single-run path, before
 *  paying for N-1 more runs. */
function runNTimes(engine, n, cases, datasetSplit, purpose) {
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
      command: commandFor(engine, n, datasetSplit, { purpose }),
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
  const parseRefusalSplit = gate.parseRefusalSplit;

  // Per-field accuracy (amountMinor/sign, for the targets report below) is
  // computed from the FIRST run only — a single `aggregate()` pass, same
  // shape as the single-sample report. With the field order pinned, greedy
  // sampling makes every repeat byte-identical in principle (README's
  // "Field-order experiment"), so this is informational, not a second
  // (cheaper) gate — any case that differs across runs is already flagged
  // elsewhere (the per-case pass-rate table above, and a non-1.0/0.0
  // pass-rate in `cases`).
  const firstRunFieldAccuracy = aggregate(cases, { [engine]: runs[0] })[engine].fieldAccuracy;
  const extendedMetrics = computeExtendedMetrics(cases, runs[0]);
  printTargetsTable(thresholds.targets, {
    parse: parseRefusalSplit.parseCases.rate,
    refusal: parseRefusalSplit.refusalCases.rate,
    amountMinor: firstRunFieldAccuracy.amountMinor,
    ledgerCorrect: extendedMetrics.ledgerCorrect.rate,
    recall: { income: extendedMetrics.recall.income.rate, transfer: extendedMetrics.recall.transfer.rate },
  });
  printStrataTable(extendedMetrics);
  // Review Major 3 — same run-0-only convention as extendedMetrics/
  // firstRunFieldAccuracy above (see those fields' own doc comments for why).
  const afterRoutingRefusal = computeAfterRoutingRefusal(
    cases,
    new Map(runs[0].map((r) => [r.id, r])),
    getRoutedIds(cases)
  );
  printAfterRoutingRefusal(afterRoutingRefusal);

  // Per-case diagnostics across all N samples — see buildCaseDiagnostics.
  const caseDiagnostics = buildCaseDiagnostics(cases, runs);
  warnOnOrderUnavailable(caseDiagnostics);

  emitResult(engine, {
    mode: 'pass-rate',
    samples: n,
    status: 'ok',
    datasetSplit,
    command: commandFor(engine, n, datasetSplit, { purpose }),
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
    extendedMetrics,
    afterRoutingRefusal,
    ...(engine === 'fm' ? { orderUnavailable: sumOrderUnavailable(caseDiagnostics) } : {}),
    cases: caseDiagnostics,
  });
  process.exit(gate.passed ? 0 : 1);
}

/** I/O wrapper around `gates.mjs`'s pure `gateAgainstBaselineReport` (review
 *  M5) — reads `evals/baseline.json` and delegates all the actual gating
 *  logic to the testable helper. */
function gateAgainstBaseline(cases, resultsById, report, datasetSplit) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return gateAgainstBaselineReport(cases, resultsById, report, datasetSplit, baseline, console, {
    baselineLabel: path.relative(REPO_ROOT, BASELINE_PATH),
  });
}

main();
