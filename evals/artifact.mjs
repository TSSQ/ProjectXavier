/**
 * Scoring of a model-tier engine's runs into the committed-artifact payload,
 * shared by `run-eval.mjs` (a live run) and `rescore.mjs` (an offline
 * re-score of a stored raw file) so the two can never disagree about how an
 * artifact is built. Dev tooling — never ships.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from './score.mjs';
import {
  buildCaseDiagnostics,
  sumOrderUnavailable,
  computePassRates,
  gateAgainstThresholds,
  gateAgainstThresholdsNRuns,
  computeExtendedMetrics,
  computePerRunMetrics,
  computeAfterRoutingRefusal,
  ESTIMATORS,
} from './gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
// The real app's `detectIntent` routing decision (a `tsx` subprocess; see
// evals/fm/intent-routing.mjs for why it has to be one).
const INTENT_ROUTING_PATH = path.join(__dirname, 'fm', 'intent-routing.mjs');

/** Shape a report's scores into the committed-artifact schema (single-sample
 *  mode). `overall` spans ALL cases (a refusal case correct on a null return);
 *  `parseCases`/`failToParse` split that population back out; `perAxis`
 *  breaks it down by dataset axis. */
export function scorePayloadFromReport(report) {
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

/** Per-axis and parse-cases/refusal-cases reliability breakdown for the
 *  `--n`-repeat mode: a case counts iff its pass-rate clears
 *  `perCaseThreshold`. */
export function computeAxisReliability(cases, passRates, perCaseThreshold) {
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

/** Real-app intent routing for the refusal cases among `cases`: a `Set` of ids
 *  routed away from the parser. Never throws (an informational figure must not
 *  crash a run): a helper fault warns and returns an empty set, which only
 *  makes the reported figure more conservative. */
export function getRoutedIds(cases) {
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
    return new Set(JSON.parse(stdout).filter((r) => r.routed).map((r) => r.id));
  } catch (e) {
    console.warn(`\nWARNING: could not compute "refusal after intent routing" (non-fatal): ${e.message}`);
    return new Set();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Score `runs` (an array of N per-run result arrays) of a model-tier engine
 *  against `cases` and build everything an artifact carries. `n === 1` yields
 *  the single-sample shape (gate on the single report); `n > 1` the pass-rate
 *  shape. The caller adds `mode`-independent envelope fields (`samples`,
 *  `status`, `datasetSplit`, `command`, ...) around `payload`.
 *
 *  ESTIMATORS (M3): `parse`/`refusal` are the pass-rate "reliable" fractions;
 *  every other figure is computed PER RUN and reported as a mean with min-max
 *  (`perRunMetrics`). `extendedMetrics`/`fieldAccuracy` stay as the run-0
 *  detail (counts, per-axis), labelled as such. */
export function scoreModelRuns({ engine, cases, runs, thresholds, routedIds, io = console }) {
  const n = runs.length;
  const report0 = aggregate(cases, { [engine]: runs[0] })[engine];
  const extended = computeExtendedMetrics(cases, runs[0]);
  const perRun = computePerRunMetrics(cases, runs, engine);
  const resultsById0 = new Map(runs[0].map((r) => [r.id, r]));
  const afterRoutingRefusal = computeAfterRoutingRefusal(cases, resultsById0, routedIds);
  const caseDiagnostics = buildCaseDiagnostics(cases, runs);
  const common = {
    targets: thresholds.targets,
    estimators: ESTIMATORS,
    perRunMetrics: perRun,
    extendedMetricsEstimator: 'run-0 (first run only): counts and per-axis detail; see perRunMetrics for mean and min-max over all runs',
    extendedMetrics: extended,
    afterRoutingRefusal,
    ...(engine === 'fm' ? { orderUnavailable: sumOrderUnavailable(caseDiagnostics) } : {}),
    cases: caseDiagnostics,
  };

  if (n === 1) {
    const passed = gateAgainstThresholds(report0, thresholds, io);
    return {
      n,
      passed,
      report: report0,
      parseRate: report0.parseAccuracy,
      refusalRate: report0.failToParseAccuracy,
      extended,
      perRun,
      afterRoutingRefusal,
      caseDiagnostics,
      payload: {
        gate: { type: 'thresholds', file: 'evals/thresholds.json', passed },
        ...scorePayloadFromReport(report0),
        ...common,
      },
    };
  }

  const passRates = computePassRates(cases, runs);
  const gate = gateAgainstThresholdsNRuns(cases, passRates, thresholds, io);
  const split = gate.parseRefusalSplit;
  return {
    n,
    passed: gate.passed,
    report: report0,
    passRates,
    gate,
    parseRate: split.parseCases.rate,
    refusalRate: split.refusalCases.rate,
    extended,
    perRun,
    afterRoutingRefusal,
    caseDiagnostics,
    payload: {
      passRate: { reliable: gate.reliable, total: gate.total, accuracy: gate.overall },
      parseCases: {
        correct: split.parseCases.reliable,
        total: split.parseCases.total,
        accuracy: split.parseCases.rate,
      },
      failToParse: {
        correct: split.refusalCases.reliable,
        total: split.refusalCases.total,
        accuracy: split.refusalCases.rate,
      },
      perAxis: computeAxisReliability(cases, passRates, thresholds.model.perCase),
      perCaseThreshold: thresholds.model.perCase,
      gate: { type: 'thresholds', file: 'evals/thresholds.json', passed: gate.passed },
      fieldAccuracy: report0.fieldAccuracy,
      ...common,
    },
  };
}
