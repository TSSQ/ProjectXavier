#!/usr/bin/env node
/**
 * Unit tests for evals/gates.mjs (review N5 — extracted out of run-eval.mjs
 * so these gate/scoring helpers are testable without shelling out to the
 * real dataset/engine runner). Same plain-assert convention as
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
  computePassRates,
  splitParseRefusalReliability,
  gateAgainstThresholds,
  gateAgainstThresholdsNRuns,
  isRepoDirty,
  isArtifactUnchanged,
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
  assert.equal(gate.split.parseCases.reliable, 1);
  assert.equal(gate.split.parseCases.rate, 1);
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
  assert.equal(gate.split.refusalCases.total, 0);
  assert.equal(gate.split.refusalCases.rate, null);
  assert.equal(gate.passed, true);
});

test('splitParseRefusalReliability_empty_population_rate_is_null_not_zero', () => {
  const cases = [{ id: 'c1', expected: { amountMinor: 100, sign: 'expense', dateISO: '2026-07-16' } }];
  const passRates = new Map([['c1', { passes: 5, total: 5, passRate: 1 }]]);
  const split = splitParseRefusalReliability(cases, passRates, 0.6);
  assert.equal(split.refusalCases.total, 0);
  assert.equal(split.refusalCases.rate, null);
});

// ─── isRepoDirty: widened pathspec (review Q1/N3) ──────────────────────────

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
  // `src/domain` (e.g. `deviceParseAttempts.ts`, which THIS follow-up
  // itself edited) would have been invisible to it. This is exactly what
  // review N3 flagged.
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

test('isRepoDirty_ignores_unrelated_paths', () => {
  const dir = initFixtureRepo();
  try {
    writeFileSync(path.join(dir, 'unrelated.txt'), 'hello\n');
    assert.equal(isRepoDirty(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── isArtifactUnchanged (review S7's no-op-rewrite comparison) ───────────

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
