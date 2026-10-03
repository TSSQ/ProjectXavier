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
  gateAgainstBaselineReport,
  evaluateRelativeBar,
  checkReferenceArtifact,
  referenceArtifactRelPath,
  formatSpread,
  isRepoDirty,
  isArtifactUnchanged,
} from './gates.mjs';
import { scorePayloadFromReport, computeAxisReliability, getRoutedIds, scoreModelRuns } from './artifact.mjs';
import { writeRaw } from './raw.mjs';
import { artifactProvenance, datasetLabelSha, parsePromptSha } from './provenance.mjs';
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
const TEST_RESCORE_PATH = path.join(__dirname, 'test-rescore.mjs');
const TEST_PAIRED_PATH = path.join(__dirname, 'test-paired.mjs');
const TEST_CUES_PATH = path.join(__dirname, 'test-cues.mjs');
const SPLIT_PATH = path.join(__dirname, 'split.mjs');
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

/** Repo-relative path of the reference artifact this run reads as an input
 *  (null when none, or when `engine` is the reference itself). */
function referenceArtifactFor(engine, datasetSplit) {
  try {
    const rel = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')).targets?.relativeToByok;
    return referenceArtifactRelPath(rel, engine, datasetSplit);
  } catch {
    return null;
  }
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
      // The relative-bar reference artifact is an INPUT that lives under
      // evals/results/, so an edit to it counts as dirty (outputs stay ignored).
      dirty: isRepoDirty(REPO_ROOT, { referenceArtifact: referenceArtifactFor(engine, payload.datasetSplit) }),
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
    TEST_RESCORE_PATH,
    TEST_PAIRED_PATH,
    TEST_CUES_PATH,
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

/** The named estimator behind each printed figure (M3). `parse`/`refusal`
 *  are the pass-rate "reliable >= perCase" fractions when N > 1; every other
 *  figure is the per-run mean with min-max. A single run has one estimator:
 *  that run. */
const estimatorTag = (key, n) =>
  n === 1 ? 'single run' : key === 'parse' || key === 'refusal' ? 'pass-rate, reliable >= 60%' : `mean of ${n} runs (min-max)`;

/** The ONE named reference engine's per-run metrics for `datasetSplit`, read
 *  from its committed artifact; `null` when absent or unusable. An artifact
 *  that exists but is not a valid comparator (other model, no per-run metrics,
 *  other labels or case count: see `checkReferenceArtifact`) is a LOUD warning
 *  plus a skipped relative bar, never a quiet comparison. `cases` are the
 *  cases the current run scored. */
function loadReferenceMetrics(rel, datasetSplit, cases) {
  const relPath = referenceArtifactRelPath(rel, null, datasetSplit);
  if (!relPath) return null;
  let art;
  try {
    art = JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
  } catch {
    return null;
  }
  const verdict = checkReferenceArtifact(art, rel, {
    datasetLabelSha: datasetLabelSha(cases),
    caseCount: cases.length,
  });
  if (verdict.skip) {
    console.warn(
      `\n${'!'.repeat(72)}\nWARNING: relative bar SKIPPED - ${relPath} is not a valid reference for this run:\n  ${verdict.skip}\n${'!'.repeat(72)}`
    );
    return null;
  }
  return verdict.metrics;
}

/** Prints `thresholds.targets` (evals/thresholds.json — a NON-gating "good
 *  enough to be the default" bar, see evals/README.md's "Good enough" bar
 *  section) alongside the actual numbers for a model-tier run, each row
 *  tagged with the estimator it uses. Never affects the exit code. `scored`
 *  is `scoreModelRuns`'s return value. */
function printTargetsTable(targets, scored, { engine, datasetSplit, cases }) {
  if (!targets) return;
  const m = scored.perRun.metrics;
  const n = scored.n;
  console.log('\nTargets ("good enough to replace BYOK" bar — not gated; estimator in brackets):');
  const flagFor = (got, target) => (got != null && got >= target ? 'MEETS' : 'below');
  const row = (label, key, value, shown, target) =>
    console.log(`  ${label.padEnd(16)} ${shown}  vs target ${pct(target)}  (${flagFor(value, target)})  [${estimatorTag(key, n)}]`);
  const spreadRows = {
    ledgerCorrect: m.ledgerCorrect,
    amountMinor: m['fieldAccuracy.amountMinor'],
  };
  for (const key of ['ledgerCorrect', 'parse', 'amountMinor', 'refusal']) {
    if (targets[key] == null) continue;
    if (key === 'parse') row(key, key, scored.parseRate, pct(scored.parseRate), targets[key]);
    else if (key === 'refusal') row(key, key, scored.refusalRate, pct(scored.refusalRate), targets[key]);
    else row(key, key, spreadRows[key]?.mean ?? null, formatSpread(spreadRows[key]), targets[key]);
  }
  if (targets.recall) {
    for (const cls of ['income', 'transfer']) {
      if (targets.recall[cls] == null) continue;
      const mm = m[`recall.${cls}`];
      row(`recall.${cls}`, `recall.${cls}`, mm?.mean ?? null, formatSpread(mm), targets.recall[cls]);
    }
  }
  printRelativeBar(targets.relativeToByok, scored, { engine, datasetSplit, cases });
}

/** Prints the non-gating relative "replace BYOK" bar: ONE named reference
 *  engine (Claude Haiku 4.5) for ledgerCorrect (within N points) and
 *  income/transfer recall (within the case allowances); refusal is the
 *  ABSOLUTE `targets.refusal` bar with a per-subtype report, never compared
 *  to BYOK, and `finance-near-miss` is set aside until the 2026-10-01 refuse
 *  rule is encoded in every engine's prompt (it is not, today). */
function printRelativeBar(rel, scored, { engine, datasetSplit, cases }) {
  if (!rel) return;
  console.log(`\n  Relative bar vs the named reference: ${rel.referenceLabel} (${rel.referenceEngine}), same split, per-run means`);
  if (engine === rel.referenceEngine) {
    console.log('    this run IS the reference engine - nothing to compare.');
  } else {
    const refMetrics = loadReferenceMetrics(rel, datasetSplit, cases);
    const rb = evaluateRelativeBar(rel, scored.perRun.metrics, refMetrics);
    if (rb.rows.length === 0) {
      console.log(`    no usable ${rel.referenceLabel} per-run artifact for split=${datasetSplit} (see any warning above) - cannot compare.`);
    }
    for (const r of rb.rows) {
      console.log(
        `    ${r.key.padEnd(16)} ${formatSpread(r.engine)} vs ${formatSpread(r.reference)}  ${r.detail}  (${r.meets ? 'MEETS' : 'below'})`
      );
    }
  }
  const rb2 = evaluateRelativeBar(rel, scored.perRun.metrics, null);
  console.log('  Refusal: absolute bar only (no BYOK comparison); per subtype (mean of runs):');
  for (const [name, mm] of Object.entries(rb2.refusalSubtypes)) {
    const note = rb2.reportedSeparately.includes(name) ? '  [reported separately, not in the refusal-comparable share: no prompt encodes the 2026-10-01 refuse rule yet]' : '';
    console.log(`    ${name.padEnd(20)} ${formatSpread(mm)} (${mm.total})${note}`);
  }
  if (rb2.refusalComparable) {
    console.log(`    refusal excl. ${rb2.reportedSeparately.join(', ')}: ${pct(rb2.refusalComparable.mean)} (${rb2.refusalComparable.total} cases)`);
  }
}

/** Prints the M3 grouped-strata floors and the per-axis target-field
 *  breakdown (each reported on its own target field, never gated), the
 *  per-vocabulary breakdown (M1: default-like vs custom category lists) and
 *  per-refusal-subtype figures. Strata/subtype/vocabulary rows are the
 *  per-run mean with min-max (`scored.perRun`); per-axis stays run-0. */
function printStrataTable(scored) {
  const { extended, perRun } = scored;
  const m = perRun.metrics;
  console.log(`\nGrouped-strata floors (each stratum on its own target field; mean of ${perRun.runs} run(s), min-max):`);
  for (const [name, { field, total }] of Object.entries(extended.strata)) {
    console.log(`  ${name.padEnd(14)} (${field.padEnd(11)}) ${formatSpread(m[`strata.${name}`])}  (n=${total})`);
  }
  console.log('\nPer-axis accuracy on its own target field (run-0 only):');
  for (const [axis, { field, correct, total, rate }] of Object.entries(extended.perAxisTargetField)) {
    console.log(`  ${axis.padEnd(24)} (${field.padEnd(11)}) ${pct(rate)}  (${correct}/${total})`);
  }
  if (Object.keys(extended.refusalBySubtype ?? {}).length > 0) {
    console.log(`\nPer refusal subtype (mean of ${perRun.runs} run(s), min-max):`);
    for (const [subtype, { total }] of Object.entries(extended.refusalBySubtype)) {
      console.log(`  ${subtype.padEnd(20)} ${formatSpread(m[`refusalBySubtype.${subtype}`])}  (n=${total})`);
    }
  }
  if (Object.keys(extended.byVocabulary ?? {}).length > 0) {
    console.log(
      `\nPer category vocabulary (default = no category name outside dev's 12-name list; custom = at least one unseen name; mean of ${perRun.runs} run(s), min-max):`
    );
    for (const [group, g] of Object.entries(extended.byVocabulary)) {
      console.log(`  ${group} (${g.cases} cases)`);
      for (const k of ['parse', 'ledgerCorrect', 'category', 'refusal']) {
        console.log(`    ${k.padEnd(14)} ${formatSpread(m[`byVocabulary.${group}.${k}`])}  (n=${g[k].total})`);
      }
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

  if (engine === 'heuristic') {
    runHeuristic(cases, datasetSplit, purpose);
    return;
  }
  runModel(engine, n, cases, datasetSplit, purpose);
}

/** The heuristic engine: deterministic, free, gated against `baseline.json`
 *  (see `gateAgainstBaselineReport`). Single-sample only; no raw storage. */
function runHeuristic(cases, datasetSplit, purpose) {
  const engine = 'heuristic';
  const results = runEngine(engine, cases);
  const resultsById = new Map(results.map((r) => [r.id, r]));
  const report = aggregate(cases, { [engine]: results })[engine];
  console.log(`eval (${engine}, split=${datasetSplit}): ${cases.length} cases`);
  printAxisTable(report.axisAccuracy);
  printFieldTable(report);
  printOverall(report);

  const passed = gateAgainstBaseline(cases, resultsById, report, datasetSplit);
  emitResult(engine, {
    mode: 'single-sample',
    samples: 1,
    status: 'ok',
    datasetSplit,
    command: commandFor(engine, 1, datasetSplit, { purpose }),
    gate: { type: 'baseline', file: 'evals/baseline.json', passed },
    ...artifactProvenance(cases),
    ...scorePayloadFromReport(report),
    cases: buildCaseDiagnostics(cases, [results]),
  });
  process.exit(passed ? 0 : 1);
}

function printOverall(report) {
  console.log(
    `\nOverall (all ${report.counts.overallTotal} cases): ${report.counts.overallCorrect}/${report.counts.overallTotal} (${pct(report.overallAccuracy)})` +
      `\n  Parse cases: ${report.counts.parseCorrect}/${report.counts.parseTotal} (${pct(report.parseAccuracy)})` +
      `   Refusal cases: ${report.counts.failToParseCorrect}/${report.counts.failToParseTotal} (${pct(report.failToParseAccuracy)})`
  );
}

/** A model-tier engine (`fm`/`openai`/`anthropic`), N runs (N=1 is the
 *  single-sample behaviour). Skips cleanly (exit 0) on the first run if the
 *  engine is unconfigured, before paying for N-1 more runs. Every run's raw
 *  per-case parses are stored (`results/raw/`, see raw.mjs) so a later label
 *  fix can be re-scored offline by `rescore.mjs`. Metrics other than the
 *  pass-rate parse/refusal figures are computed PER RUN and reported as a
 *  mean with min-max (estimators are named in the output and the artifact). */
function runModel(engine, n, cases, datasetSplit, purpose) {
  const firstRun = runEngine(engine, cases);
  if (firstRun.every((r) => r.status === 'skipped')) {
    const reason = firstRun[0]?.reason ?? 'skipped';
    console.log(`eval (${engine}${n > 1 ? `, N=${n}` : ''}): skipped — ${reason}`);
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
  const command = commandFor(engine, n, datasetSplit, { purpose });
  try {
    const rawFile = writeRaw({ engine, model: engineModel(engine), datasetSplit, command, gitSha: gitSha(), runs, extraHeader: { parsePromptSha: parsePromptSha() } });
    if (rawFile) console.log(`eval: raw per-run parses -> ${path.relative(REPO_ROOT, rawFile)}`);
  } catch (e) {
    console.error(`eval: could not write raw per-run parses (non-fatal): ${e.message}`);
  }

  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  if (n === 1) {
    console.log(`eval (${engine}, split=${datasetSplit}): ${cases.length} cases`);
    const report = aggregate(cases, { [engine]: firstRun })[engine];
    printAxisTable(report.axisAccuracy);
    printFieldTable(report);
    printOverall(report);
    if (report.errors.length > 0) {
      console.log(`\n${report.errors.length} case(s) errored:`);
      for (const e of report.errors) console.log(`  ${e.id}: ${e.error}`);
    }
  } else {
    console.log(`eval (${engine}, N=${n}, split=${datasetSplit}): ${cases.length} cases x ${n} runs`);
    const passRates = computePassRates(cases, runs);
    printPassRateTable(cases, passRates, thresholds.model.perCase);
    printAxisTable(
      Object.fromEntries(
        Object.entries(computeAxisReliability(cases, passRates, thresholds.model.perCase)).map(
          ([axis, { reliable, total }]) => [axis, { correct: reliable, total }]
        )
      )
    );
  }

  const scored = scoreModelRuns({ engine, cases, runs, thresholds, routedIds: getRoutedIds(cases) });
  printTargetsTable(thresholds.targets, scored, { engine, datasetSplit, cases });
  printStrataTable(scored);
  printAfterRoutingRefusal(scored.afterRoutingRefusal);
  warnOnOrderUnavailable(scored.caseDiagnostics);

  emitResult(engine, {
    // `mode` discriminates the two committed-artifact shapes: 'single-sample'
    // carries `overall` + `fields`; 'pass-rate' carries `passRate` instead.
    mode: n === 1 ? 'single-sample' : 'pass-rate',
    samples: n,
    status: 'ok',
    datasetSplit,
    command,
    ...artifactProvenance(cases),
    ...scored.payload,
  });
  process.exit(scored.passed ? 0 : 1);
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
