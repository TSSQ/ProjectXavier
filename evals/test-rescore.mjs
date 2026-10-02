#!/usr/bin/env node
/**
 * Tests for raw per-run storage (raw.mjs), the offline re-score
 * (rescore.mjs) and the shared artifact builder (artifact.mjs). No model, no
 * network, no tsx subprocess (`routedIds` is injected).
 *
 * Run: `node evals/test-rescore.mjs`
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRaw, readRaw, rawPathFor, HOLDOUT_RAW_WARNING } from './raw.mjs';
import { rescoreRaw, buildRescoredArtifact } from './rescore.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const NOW = Date.parse('2026-10-02T12:00:00Z');
const THRESHOLDS = {
  model: { parse: 0.8, refusal: 0.85, perCase: 0.6 },
  targets: { ledgerCorrect: 0.95 },
};
const label = (over = {}) => ({
  amountMinor: 500,
  sign: 'expense',
  dateISO: '2026-10-02',
  category: null,
  payee: null,
  ...over,
});
const mkCases = (signOfC1 = 'expense') => [
  { id: 'c1', axis: 'plain', split: 'dev', expected: label({ sign: signOfC1 }), context: {} },
  { id: 'c2', axis: 'plain', split: 'dev', expected: label(), context: {} },
  { id: 'c3', axis: 'fail-to-parse', subtype: 'gibberish', split: 'dev', expected: null, context: {} },
];
const okParse = (over = {}) => ({ amount: 500, type: 'expense', occurredAt: NOW, category: null, payee: null, ...over });
const run = () => [
  { id: 'c1', status: 'ok', parse: okParse() },
  { id: 'c2', status: 'ok', parse: okParse() },
  { id: 'c3', status: 'ok', parse: null },
];

function withTmp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xavier-rescore-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const write = (dir, over = {}) =>
  writeRaw({
    engine: 'anthropic',
    model: 'claude-haiku-4-5',
    datasetSplit: 'dev',
    command: 'cmd',
    gitSha: 'abc1234',
    runs: [run(), run(), run()],
    rawDir: dir,
    ...over,
  });

test('raw_file_roundtrips_header_and_per_run_results', () =>
  withTmp((dir) => {
    const file = write(dir);
    assert.equal(file, rawPathFor('anthropic', 'dev', dir));
    const { header, runs } = readRaw(file);
    assert.equal(header.samples, 3);
    assert.equal(header.engine, 'anthropic');
    assert.equal(runs.length, 3);
    assert.deepEqual(runs[2].map((r) => r.id), ['c1', 'c2', 'c3']);
    assert.equal(runs[0][2].parse, null);
    assert.equal(runs[1][0].parse.amount, 500);
  }));

test('holdout_raw_files_carry_the_contamination_warning_in_the_header_and_dev_does_not', () =>
  withTmp((dir) => {
    for (const split of ['holdout', 'holdout2', 'all']) {
      const first = readFileSync(write(dir, { datasetSplit: split }), 'utf8').split('\n')[0];
      assert.equal(JSON.parse(first).warning, HOLDOUT_RAW_WARNING, split);
    }
    assert.match(HOLDOUT_RAW_WARNING, /contaminates the holdout/);
    const dev = JSON.parse(readFileSync(write(dir, { datasetSplit: 'dev' }), 'utf8').split('\n')[0]);
    assert.equal(dev.warning, undefined);
  }));

test('an_identical_rerun_does_not_rewrite_the_raw_file', () =>
  withTmp((dir) => {
    assert.ok(write(dir));
    assert.equal(write(dir, { gitSha: 'different' }), null);
    assert.ok(write(dir, { runs: [run()] }), 'changed body is written');
  }));

test('rescore_reflects_a_label_fix_without_calling_any_model', () =>
  withTmp((dir) => {
    const file = write(dir);
    // Wrong label (income) -> c1 fails in every run.
    const before = rescoreRaw(file, { cases: mkCases('income'), thresholds: THRESHOLDS, routedIds: new Set() });
    assert.equal(before.scored.passRates.get('c1').passes, 0);
    assert.equal(before.scored.perRun.metrics.ledgerCorrect.mean, 0.5);
    // Label fixed -> the same stored parses now pass.
    const after = rescoreRaw(file, { cases: mkCases('expense'), thresholds: THRESHOLDS, routedIds: new Set() });
    assert.equal(after.scored.passRates.get('c1').passes, 3);
    assert.equal(after.scored.perRun.metrics.ledgerCorrect.mean, 1);
    assert.equal(after.scored.parseRate, 1);
    assert.equal(after.scored.refusalRate, 1);
  }));

test('rescore_only_scores_cases_present_in_the_raw_file', () =>
  withTmp((dir) => {
    const file = write(dir);
    const extra = [...mkCases(), { id: 'later', axis: 'plain', split: 'dev', expected: label(), context: {} }];
    const r = rescoreRaw(file, { cases: extra, thresholds: THRESHOLDS, routedIds: new Set() });
    assert.deepEqual(r.unscored, ['later']);
    assert.equal(r.cases.length, 3);
  }));

test('per_run_metrics_are_computed_for_every_run_with_mean_min_max', () =>
  withTmp((dir) => {
    const runs = [run(), run(), run()];
    runs[1][1] = { id: 'c2', status: 'ok', parse: okParse({ amount: 999 }) }; // run 1 misses c2
    const file = write(dir, { runs });
    const { scored } = rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() });
    const lc = scored.perRun.metrics.ledgerCorrect;
    assert.deepEqual(lc.perRun, [1, 0.5, 1]);
    assert.equal(lc.min, 0.5);
    assert.equal(lc.max, 1);
    assert.ok(Math.abs(lc.mean - 2.5 / 3) < 1e-12);
    assert.equal(scored.perRun.runs, 3);
    // The estimators are named on the payload.
    assert.match(scored.payload.estimators.parse, /pass-rate/);
    assert.match(scored.payload.estimators.others, /mean over the N runs/);
  }));

test('the_rewritten_artifact_records_that_it_was_rescored_offline', () =>
  withTmp((dir) => {
    const file = write(dir);
    const result = rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() });
    const existing = { engine: 'anthropic', model: 'claude-haiku-4-5', gitSha: 'old', generatedAt: 'then', command: 'orig cmd', datasetSplit: 'dev', samples: 3 };
    const art = buildRescoredArtifact(existing, result, { reason: 'label fix', rawRelPath: 'x.jsonl', sha: 'new', dirty: false });
    assert.equal(art.rescoredOffline.reason, 'label fix');
    assert.equal(art.rescoredOffline.originalGitSha, 'old');
    assert.match(art.rescoredOffline.note, /OFFLINE/);
    assert.equal(art.command, 'orig cmd');
    assert.equal(art.gitSha, 'new');
    assert.equal(art.mode, 'pass-rate');
    assert.ok(art.perRunMetrics && art.extendedMetrics && art.cases);
  }));

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
