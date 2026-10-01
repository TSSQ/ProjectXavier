#!/usr/bin/env node
/**
 * Unit tests for evals/gates.mjs — extracted out of run-eval.mjs so these
 * gate/scoring helpers are testable without shelling out to the real
 * dataset/engine runner. Same plain-assert convention as
 * evals/test-score.mjs.
 *
 * Run: `node evals/test-gates.mjs` (exits non-zero on any mismatch).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  casePassed,
  buildCaseDiagnostics,
  sumOrderUnavailable,
  computePassRates,
  splitParseRefusalReliability,
  gateAgainstThresholds,
  gateAgainstThresholdsNRuns,
  isRepoDirty,
  isArtifactUnchanged,
  fieldValueForCase,
  computeFieldAccuracy,
  computeAllStrata,
  computeLedgerCorrect,
  computeClassRecall,
  computeExtendedMetrics,
  gateAgainstBaselineReport,
  STRATA,
} from './gates.mjs';

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

/** A no-op logger/error sink so gate functions' console output doesn't spam
 *  test runs — passed as the `io` param the gate functions accept. */
const silentIo = { log: () => {}, error: () => {} };

// ─── casePassed: a harness error is a FAILURE in EITHER population ─────────

test('casePassed_error_status_fails_a_parse_case', () => {
  const caseObj = { id: 'c1', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' } };
  const result = { status: 'error', error: 'probe timed out', parse: null };
  assert.equal(casePassed(caseObj, result), false);
});

test('casePassed_error_status_fails_a_refusal_case', () => {
  // A refusal case (`expected: null`) would otherwise trivially "pass" any
  // `parse === null` result — an `error` status must NOT be read that way.
  const caseObj = { id: 'c2', expected: null };
  const result = { status: 'error', error: 'probe timed out', parse: null };
  assert.equal(casePassed(caseObj, result), false);
});

test('casePassed_ok_status_null_parse_passes_a_refusal_case', () => {
  // Sanity check alongside the two above: a NON-error null parse against a
  // refusal case does pass — only `status: 'error'` is special-cased.
  const caseObj = { id: 'c3', expected: null };
  const result = { status: 'ok', parse: null };
  assert.equal(casePassed(caseObj, result), true);
});

// ─── per-case pass-rate boundary: 3/5 = 0.6 passes a 0.6 threshold ─────────

test('per_case_pass_rate_boundary_is_inclusive', () => {
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const okResult = { id: 'c1', status: 'ok', parse: { amount: 100, type: 'expense', occurredAt: Date.parse('2026-07-16') } };
  const failResult = { id: 'c1', status: 'ok', parse: null };
  // 3 of 5 runs pass -> passRate exactly 0.6.
  const runs = [[okResult], [okResult], [okResult], [failResult], [failResult]];
  const passRates = computePassRates(cases, runs);
  assert.equal(passRates.get('c1').passRate, 0.6);

  const thresholds = { model: { perCase: 0.6, parse: 1, refusal: 1 } };
  const gate = gateAgainstThresholdsNRuns(cases, passRates, thresholds, silentIo);
  // A 0.6 pass-rate against a 0.6 perCase threshold must count as RELIABLE
  // (boundary-inclusive `>=`), so this single parse case clears
  // thresholds.model.parse (1 of 1 reliable = 100%).
  assert.equal(gate.reliable, 1);
  assert.equal(gate.parseRefusalSplit.parseCases.reliable, 1);
  assert.equal(gate.parseRefusalSplit.parseCases.rate, 1);
});

test('per_case_pass_rate_boundary_just_below_is_excluded', () => {
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const okResult = { id: 'c1', status: 'ok', parse: { amount: 100, type: 'expense', occurredAt: Date.parse('2026-07-16') } };
  const failResult = { id: 'c1', status: 'ok', parse: null };
  // 2 of 5 runs pass -> passRate 0.4, strictly below a 0.6 threshold.
  const runs = [[okResult], [okResult], [failResult], [failResult], [failResult]];
  const passRates = computePassRates(cases, runs);
  assert.equal(passRates.get('c1').passRate, 0.4);
  const thresholds = { model: { perCase: 0.6, parse: 1, refusal: 1 } };
  const gate = gateAgainstThresholdsNRuns(cases, passRates, thresholds, silentIo);
  assert.equal(gate.reliable, 0);
});

// ─── empty refusal (or parse) population: n/a, never a spurious FAIL ──────

test('gateAgainstThresholds_empty_refusal_population_is_not_a_failure', () => {
  const report = {
    parseAccuracy: 1,
    failToParseAccuracy: null, // score.mjs's aggregate() reports null, not 0, on an empty population
    counts: { parseTotal: 5, failToParseTotal: 0 },
  };
  const thresholds = { model: { parse: 0.8, refusal: 0.85 } };
  const passed = gateAgainstThresholds(report, thresholds, silentIo);
  assert.equal(passed, true);
});

test('gateAgainstThresholds_empty_parse_population_is_not_a_failure', () => {
  const report = {
    parseAccuracy: null,
    failToParseAccuracy: 1,
    counts: { parseTotal: 0, failToParseTotal: 7 },
  };
  const thresholds = { model: { parse: 0.8, refusal: 0.85 } };
  const passed = gateAgainstThresholds(report, thresholds, silentIo);
  assert.equal(passed, true);
});

test('gateAgainstThresholds_still_fails_a_real_below_threshold_population', () => {
  const report = {
    parseAccuracy: 0.5,
    failToParseAccuracy: 1,
    counts: { parseTotal: 10, failToParseTotal: 7 },
  };
  const thresholds = { model: { parse: 0.8, refusal: 0.85 } };
  const passed = gateAgainstThresholds(report, thresholds, silentIo);
  assert.equal(passed, false);
});

test('gateAgainstThresholdsNRuns_empty_refusal_population_is_not_a_failure', () => {
  // A dataset with ONLY parse cases (no refusal cases at all) — this used to
  // read `null ?? 0` as "0% reliable" and spuriously FAIL the refusal gate.
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const passRates = new Map([['c1', { passes: 5, total: 5, passRate: 1 }]]);
  const thresholds = { model: { perCase: 0.6, parse: 0.8, refusal: 0.85 } };
  const gate = gateAgainstThresholdsNRuns(cases, passRates, thresholds, silentIo);
  assert.equal(gate.parseRefusalSplit.refusalCases.total, 0);
  assert.equal(gate.parseRefusalSplit.refusalCases.rate, null);
  assert.equal(gate.passed, true);
});

test('splitParseRefusalReliability_empty_population_rate_is_null_not_zero', () => {
  const cases = [{ id: 'c1', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const passRates = new Map([['c1', { passes: 5, total: 5, passRate: 1 }]]);
  const split = splitParseRefusalReliability(cases, passRates, 0.6);
  assert.equal(split.refusalCases.total, 0);
  assert.equal(split.refusalCases.rate, null);
});

// ─── isRepoDirty: widened pathspec ──────────────────────────────────────────

/** A throwaway git repo in the OS temp dir (never the project repo) so this
 *  test can freely create/modify/commit files without touching real repo
 *  state. `initFixtureRepo` commits an initial empty commit so `git status`
 *  has a HEAD to diff against. */
function initFixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gates-dirty-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--allow-empty', '-q', '-m', 'init'],
    { cwd: dir }
  );
  return dir;
}

test('isRepoDirty_widened_pathspec_catches_a_change_anywhere_under_src_domain', () => {
  // The OLD pathspec only watched the single file
  // `src/domain/deviceParsePrompt.ts` — a change to any OTHER file under
  // `src/domain` (e.g. `deviceParseAttempts.ts`) would have been invisible
  // to it.
  const dir = initFixtureRepo();
  try {
    assert.equal(isRepoDirty(dir), false, 'freshly committed repo should start clean');
    mkdirSync(path.join(dir, 'src', 'domain'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'domain', 'someOtherFile.ts'), 'export const x = 1;\n');
    assert.equal(isRepoDirty(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isRepoDirty_widened_pathspec_also_catches_src_lib_and_src_features_ai_and_lockfile', () => {
  const dir = initFixtureRepo();
  try {
    mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'lib', 'validation.ts'), 'export const y = 1;\n');
    assert.equal(isRepoDirty(dir), true, 'src/lib change should mark dirty');

    execFileSync('git', ['clean', '-fdq'], { cwd: dir });
    mkdirSync(path.join(dir, 'src', 'features', 'ai'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'features', 'ai', 'deviceParse.ts'), 'export const z = 1;\n');
    assert.equal(isRepoDirty(dir), true, 'src/features/ai change should mark dirty');

    execFileSync('git', ['clean', '-fdq'], { cwd: dir });
    writeFileSync(path.join(dir, 'package-lock.json'), '{}\n');
    assert.equal(isRepoDirty(dir), true, 'package-lock.json change should mark dirty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Like `initFixtureRepo`, but also commits one tracked placeholder file
 *  under `evals/` first — git's porcelain output COLLAPSES a brand-new,
 *  entirely-untracked directory to a single `?? evals/` line (no per-file
 *  detail at all), which isn't what the real project repo looks like
 *  (`evals/` already has many tracked files) and would make a path-specific
 *  exclusion filter (`.includes('evals/results/')`) silently never match in
 *  THIS test's fixture. Seeding one tracked file first reproduces the real
 *  shape: individual untracked/modified paths under `evals/` each get their
 *  own porcelain line. */
function initFixtureRepoWithTrackedEvals() {
  const dir = initFixtureRepo();
  mkdirSync(path.join(dir, 'evals'), { recursive: true });
  writeFileSync(path.join(dir, 'evals', 'dataset.jsonl'), '{}\n');
  execFileSync('git', ['add', 'evals/dataset.jsonl'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'seed evals/'],
    { cwd: dir }
  );
  return dir;
}

test('isRepoDirty_ignores_an_untracked_or_modified_evals_results_file', () => {
  const dir = initFixtureRepoWithTrackedEvals();
  try {
    mkdirSync(path.join(dir, 'evals', 'results'), { recursive: true });
    writeFileSync(path.join(dir, 'evals', 'results', 'heuristic.json'), '{}\n');
    assert.equal(isRepoDirty(dir), false, 'a fresh/untracked evals/results/* file must not mark dirty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isRepoDirty_ignores_the_holdout_looks_log_a_run_just_wrote_to_itself', () => {
  // guardAndLogHoldoutLook (run-eval.mjs) writes evals/holdout-looks.json
  // BEFORE the engine runs, in the SAME process — without this exclusion, a
  // confirmed holdout/all run would always self-report dirty:true purely
  // from its own log write moments earlier.
  const dir = initFixtureRepoWithTrackedEvals();
  try {
    writeFileSync(path.join(dir, 'evals', 'holdout-looks.json'), '[]\n');
    assert.equal(isRepoDirty(dir), false, 'a fresh/untracked evals/holdout-looks.json must not mark dirty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isRepoDirty_ignores_unrelated_paths', () => {
  const dir = initFixtureRepo();
  try {
    writeFileSync(path.join(dir, 'unrelated.txt'), 'hello\n');
    assert.equal(isRepoDirty(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── isArtifactUnchanged (no-op-rewrite comparison) ────────────────────────

test('isArtifactUnchanged_true_when_only_gitSha_and_generatedAt_differ', () => {
  const existing = { gitSha: 'abc123', generatedAt: '2026-01-01T00:00:00.000Z', overall: { accuracy: 1 } };
  const candidate = { gitSha: 'def456', generatedAt: '2026-02-02T00:00:00.000Z', overall: { accuracy: 1 } };
  assert.equal(isArtifactUnchanged(existing, candidate), true);
});

test('isArtifactUnchanged_false_when_a_real_field_differs', () => {
  const existing = { gitSha: 'abc123', generatedAt: '2026-01-01T00:00:00.000Z', overall: { accuracy: 1 } };
  const candidate = { gitSha: 'abc123', generatedAt: '2026-01-01T00:00:00.000Z', overall: { accuracy: 0.9 } };
  assert.equal(isArtifactUnchanged(existing, candidate), false);
});

test('isArtifactUnchanged_false_when_no_existing_file', () => {
  assert.equal(isArtifactUnchanged(null, { overall: { accuracy: 1 } }), false);
});

// ─── buildCaseDiagnostics: sampleDiagnostics ties order to per-sample outcome ─────

test('buildCaseDiagnostics_sampleDiagnostics_ties_order_to_each_samples_own_outcome', () => {
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const okParse = { amount: 100, type: 'expense', occurredAt: Date.parse('2026-07-16') };
  const run1 = [
    {
      id: 'c1',
      status: 'ok',
      parse: okParse,
      diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: true, fieldOrders: [['amount', 'type']], attemptsDetail: [{ order: ['amount', 'type'], useful: true }], orderUnavailable: 0 },
    },
  ];
  const run2 = [
    {
      id: 'c1',
      status: 'ok',
      parse: null, // this sample FAILED
      diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: false, fieldOrders: [['type', 'amount']], attemptsDetail: [{ order: ['type', 'amount'], useful: false }], orderUnavailable: 0 },
    },
  ];
  const diagnostics = buildCaseDiagnostics(cases, [run1, run2]);
  const c1 = diagnostics.find((d) => d.id === 'c1');
  assert.equal(c1.passes, 1);
  assert.equal(c1.samples, 2);
  // Exactly one entry per SAMPLE (not deduplicated/merged) — ties a specific
  // order to a specific sample's outcome, unlike a case-wide deduplicated
  // order set.
  assert.equal(c1.sampleDiagnostics.length, 2);
  assert.equal(c1.sampleDiagnostics[0].sample, 0);
  assert.equal(c1.sampleDiagnostics[0].passed, true);
  assert.deepEqual(c1.sampleDiagnostics[0].attempts, [{ order: ['amount', 'type'], useful: true }]);
  assert.equal(c1.sampleDiagnostics[0].wrongFields, undefined);
  assert.equal(c1.sampleDiagnostics[1].sample, 1);
  assert.equal(c1.sampleDiagnostics[1].passed, false);
  assert.deepEqual(c1.sampleDiagnostics[1].attempts, [{ order: ['type', 'amount'], useful: false }]);
  assert.ok(c1.sampleDiagnostics[1].wrongFields?.length > 0);
});

test('buildCaseDiagnostics_omits_sampleDiagnostics_when_every_sample_passes', () => {
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const okParse = { amount: 100, type: 'expense', occurredAt: Date.parse('2026-07-16') };
  const okResult = {
    id: 'c1',
    status: 'ok',
    parse: okParse,
    diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: true, fieldOrders: [['amount']], attemptsDetail: [{ order: ['amount'], useful: true }], orderUnavailable: 0 },
  };
  const diagnostics = buildCaseDiagnostics(cases, [[okResult], [okResult]]);
  const c1 = diagnostics.find((d) => d.id === 'c1');
  // Kept reasonably sized: no wrongFields at all -> no sampleDiagnostics
  // either, even though diagnostics data exists.
  assert.equal(c1.sampleDiagnostics, undefined);
});

test('buildCaseDiagnostics_sample_index_survives_a_run_with_no_diagnostics', () => {
  // run1 is a harness-fault run for this case (no `diagnostics` at all) —
  // sampleDiagnostics/attemptsPerRun/firstAttemptUsefulPerRun entries must
  // still carry the REAL index into `runs` (1, not 0) for the sample that
  // does have diagnostics, since a position-only array would silently
  // relabel it as sample 0.
  const cases = [{ id: 'c1', axis: 'plain', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const run1 = [{ id: 'c1', status: 'error', error: 'probe timed out', parse: null }];
  const run2 = [
    {
      id: 'c1',
      status: 'ok',
      parse: null,
      diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: false, fieldOrders: [['amount']], attemptsDetail: [{ order: ['amount'], useful: false }], orderUnavailable: 0 },
    },
  ];
  const diagnostics = buildCaseDiagnostics(cases, [run1, run2]);
  const c1 = diagnostics.find((d) => d.id === 'c1');
  assert.equal(c1.sampleDiagnostics.length, 1);
  assert.equal(c1.sampleDiagnostics[0].sample, 1);
  assert.equal(c1.attemptsPerRun.length, 1);
  assert.equal(c1.attemptsPerRun[0].sample, 1);
  assert.equal(c1.firstAttemptUsefulPerRun[0].sample, 1);
});

// ─── orderUnavailable accounting ────────────────────────────────────────────

test('sumOrderUnavailable_sums_across_every_case', () => {
  const caseDiagnostics = [
    { id: 'c1', orderUnavailable: 2 },
    { id: 'c2' }, // absent -> treated as 0
    { id: 'c3', orderUnavailable: 1 },
  ];
  assert.equal(sumOrderUnavailable(caseDiagnostics), 3);
});

test('buildCaseDiagnostics_surfaces_orderUnavailable_per_case_only_when_nonzero', () => {
  const cases = [{ id: 'c1', axis: 'plain', expected: null }];
  const result = {
    id: 'c1',
    status: 'ok',
    parse: null,
    diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: false, fieldOrders: [], attemptsDetail: [{ order: null, useful: false }], orderUnavailable: 1 },
  };
  const diagnostics = buildCaseDiagnostics(cases, [[result]]);
  assert.equal(diagnostics[0].orderUnavailable, 1);
  assert.equal(sumOrderUnavailable(diagnostics), 1);
});

test('buildCaseDiagnostics_sums_orderUnavailable_across_multiple_runs_not_just_last', () => {
  // Catches an `orderUnavailable +=` -> `=` regression: two runs of the SAME
  // case, each reporting orderUnavailable: 1, must sum to 2, not overwrite
  // to 1.
  const cases = [{ id: 'c1', axis: 'plain', expected: null }];
  const makeResult = () => ({
    id: 'c1',
    status: 'ok',
    parse: null,
    diagnostics: { attempts: 1, threw: 0, firstAttemptUseful: false, fieldOrders: [], attemptsDetail: [{ order: null, useful: false }], orderUnavailable: 1 },
  });
  const diagnostics = buildCaseDiagnostics(cases, [[makeResult()], [makeResult()]]);
  const c1 = diagnostics.find((d) => d.id === 'c1');
  assert.equal(c1.orderUnavailable, 2);
  assert.equal(sumOrderUnavailable(diagnostics), 2);
});

// ─── M3: ledgerCorrect, per-class recall, grouped-strata floors ───────────

const expenseCase = { id: 'e1', axis: 'plain', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' } };
const incomeCase = { id: 'i1', axis: 'income', expected: { amountMinor: 1000, sign: 'income', dateISO: '2026-07-16' } };
const transferCase = { id: 't1', axis: 'transfer', expected: { amountMinor: 2000, sign: 'transfer', dateISO: '2026-07-16' } };
const refusalCase = { id: 'r1', axis: 'fail-to-parse', expected: null };

test('computeLedgerCorrect_requires_amount_sign_and_date_all_correct', () => {
  const cases = [expenseCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
  ]);
  const ledger = computeLedgerCorrect(cases, resultsById);
  assert.equal(ledger.correct, 1);
  assert.equal(ledger.total, 1);
  assert.equal(ledger.rate, 1);
});

test('computeLedgerCorrect_fails_when_only_amount_and_sign_are_right_but_date_is_wrong', () => {
  const cases = [expenseCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-01T00:00:00Z'), category: null, payee: null } }],
  ]);
  const ledger = computeLedgerCorrect(cases, resultsById);
  assert.equal(ledger.correct, 0);
  assert.equal(ledger.total, 1);
});

test('computeLedgerCorrect_excludes_refusal_cases_from_its_denominator', () => {
  const cases = [expenseCase, refusalCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['r1', { status: 'ok', parse: null }],
  ]);
  const ledger = computeLedgerCorrect(cases, resultsById);
  assert.equal(ledger.total, 1, 'the refusal case must not count toward ledgerCorrect\'s denominator');
});

test('computeClassRecall_is_the_fraction_of_a_class_correctly_classified_not_overall_sign_accuracy', () => {
  // The exact scenario M3 calls out: overall sign accuracy can stay high
  // while one minority class's recall is much lower.
  const cases = [
    { id: 'e1', axis: 'plain', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' } },
    { id: 'e2', axis: 'plain', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' } },
    { id: 'e3', axis: 'plain', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' } },
    incomeCase,
  ];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['e2', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['e3', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    // The income case is misclassified as expense.
    ['i1', { status: 'ok', parse: { amount: 1000, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
  ]);
  const overallSign = cases.filter((c) => resultsById.get(c.id).parse.type === c.expected.sign).length / cases.length;
  assert.equal(overallSign, 0.75, 'sanity: overall sign accuracy looks fine (75%)');
  const incomeRecall = computeClassRecall(cases, resultsById, 'income');
  assert.equal(incomeRecall.rate, 0, 'income recall is 0% even though overall sign accuracy is 75%');
});

test('computeClassRecall_only_counts_cases_whose_label_asserts_that_class', () => {
  const cases = [expenseCase, incomeCase, transferCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: 0, category: null, payee: null } }],
    ['i1', { status: 'ok', parse: { amount: 1000, type: 'income', occurredAt: 0, category: null, payee: null } }],
    ['t1', { status: 'ok', parse: { amount: 2000, type: 'expense', occurredAt: 0, category: null, payee: null } }],
  ]);
  assert.deepEqual(computeClassRecall(cases, resultsById, 'income'), { correct: 1, total: 1, rate: 1 });
  assert.deepEqual(computeClassRecall(cases, resultsById, 'transfer'), { correct: 0, total: 1, rate: 0 });
});

test('fieldValueForCase_refusal_field_only_applies_to_refusal_cases', () => {
  assert.equal(fieldValueForCase(expenseCase, { status: 'ok', parse: null }, 'refusal'), null);
  assert.equal(fieldValueForCase(refusalCase, { status: 'ok', parse: null }, 'refusal'), true);
  assert.equal(fieldValueForCase(refusalCase, { status: 'ok', parse: { amount: 1, type: 'expense', occurredAt: 0, category: null, payee: null } }, 'refusal'), false);
});

test('fieldValueForCase_amountMinor_does_not_apply_to_a_refusal_case', () => {
  assert.equal(fieldValueForCase(refusalCase, { status: 'ok', parse: null }, 'amountMinor'), null);
});

test('fieldValueForCase_an_error_status_counts_as_a_miss_for_an_applicable_objective_field', () => {
  assert.equal(fieldValueForCase(expenseCase, { status: 'error', error: 'boom' }, 'amountMinor'), false);
});

test('computeFieldAccuracy_restricts_to_the_given_axes', () => {
  const cases = [expenseCase, incomeCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['i1', { status: 'ok', parse: { amount: 999, type: 'income', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
  ]);
  const amountOnIncomeAxis = computeFieldAccuracy(cases, resultsById, ['income'], 'amountMinor');
  assert.equal(amountOnIncomeAxis.total, 1);
  assert.equal(amountOnIncomeAxis.correct, 0);
});

test('computeAllStrata_covers_every_STRATA_key', () => {
  const cases = [expenseCase, incomeCase, transferCase, refusalCase];
  const resultsById = new Map([
    ['e1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['i1', { status: 'ok', parse: { amount: 1000, type: 'income', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['t1', { status: 'ok', parse: { amount: 2000, type: 'transfer', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
    ['r1', { status: 'ok', parse: null }],
  ]);
  const strata = computeAllStrata(cases, resultsById);
  assert.deepEqual(Object.keys(strata).sort(), Object.keys(STRATA).sort());
  assert.equal(strata['sign-hard'].field, 'sign');
  assert.equal(strata['sign-hard'].total, 2, 'income + transfer axes, not the plain/fail-to-parse ones');
  assert.equal(strata.refusal.correct, 1);
  assert.equal(strata.refusal.total, 1);
});

test('computeExtendedMetrics_returns_ledgerCorrect_recall_and_strata_together', () => {
  const cases = [expenseCase, incomeCase, transferCase, refusalCase];
  const results = [
    { id: 'e1', status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } },
    { id: 'i1', status: 'ok', parse: { amount: 1000, type: 'income', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } },
    { id: 't1', status: 'ok', parse: { amount: 2000, type: 'transfer', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } },
    { id: 'r1', status: 'ok', parse: null },
  ];
  const extended = computeExtendedMetrics(cases, results);
  assert.equal(extended.ledgerCorrect.rate, 1);
  assert.equal(extended.recall.income.rate, 1);
  assert.equal(extended.recall.transfer.rate, 1);
  assert.ok(extended.strata);
  assert.ok(extended.perAxisTargetField);
});

// ─── M5: gateAgainstBaselineReport is split-aware ──────────────────────────

test('gateAgainstBaselineReport_does_not_false_regress_on_baseline_passing_ids_outside_the_current_split', () => {
  // The exact bug M5 describes: a --split=dev run must not be penalized for
  // "missing" a baseline-passing case that's actually in holdout, outside
  // this run's case set entirely.
  const devCase = { id: 'dev1', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' }, split: 'dev' };
  const cases = [devCase]; // only the dev case is in THIS run
  const resultsById = new Map([
    ['dev1', { status: 'ok', parse: { amount: 500, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
  ]);
  const report = { overallAccuracy: 1 };
  const baseline = {
    bySplit: {
      dev: { overallAccuracy: 1, passingCaseIds: ['dev1'] },
      holdout: { overallAccuracy: 1, passingCaseIds: ['holdout1'] },
      all: { overallAccuracy: 1, passingCaseIds: ['dev1', 'holdout1'] },
    },
  };
  const passed = gateAgainstBaselineReport(cases, resultsById, report, 'dev', baseline, silentIo);
  assert.equal(passed, true, 'a holdout-only baseline-passing id must never count as a regression on a dev run');
});

test('gateAgainstBaselineReport_still_fails_a_real_regression_within_the_requested_split', () => {
  const devCase = { id: 'dev1', expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-07-16' }, split: 'dev' };
  const cases = [devCase];
  const resultsById = new Map([
    ['dev1', { status: 'ok', parse: { amount: 999, type: 'expense', occurredAt: Date.parse('2026-07-16T00:00:00Z'), category: null, payee: null } }],
  ]);
  const report = { overallAccuracy: 0 };
  const baseline = { bySplit: { dev: { overallAccuracy: 1, passingCaseIds: ['dev1'] } } };
  const passed = gateAgainstBaselineReport(cases, resultsById, report, 'dev', baseline, silentIo);
  assert.equal(passed, false);
});

test('gateAgainstBaselineReport_compares_overallAccuracy_against_the_requested_splits_own_baseline', () => {
  const cases = [{ id: 'c1', expected: null, split: 'dev' }];
  const resultsById = new Map([['c1', { status: 'ok', parse: null }]]);
  const report = { overallAccuracy: 0.5 };
  const baseline = { bySplit: { dev: { overallAccuracy: 0.9, passingCaseIds: [] } } };
  const passed = gateAgainstBaselineReport(cases, resultsById, report, 'dev', baseline, silentIo);
  assert.equal(passed, false, '0.5 < the dev-specific baseline of 0.9, not the (absent) all-case figure');
});

test('gateAgainstBaselineReport_falls_back_to_the_legacy_flat_shape_when_bySplit_is_absent', () => {
  const cases = [{ id: 'c1', expected: null, split: 'all' }];
  const resultsById = new Map([['c1', { status: 'ok', parse: null }]]);
  const report = { overallAccuracy: 1 };
  const baseline = { overallAccuracy: 1, passingCaseIds: ['c1'] }; // no bySplit at all
  const passed = gateAgainstBaselineReport(cases, resultsById, report, 'all', baseline, silentIo);
  assert.equal(passed, true);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
