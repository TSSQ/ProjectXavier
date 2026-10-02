#!/usr/bin/env node
/**
 * Tests for raw per-run storage (raw.mjs), the offline re-score
 * (rescore.mjs) and the shared artifact builder (artifact.mjs). No model, no
 * network, no tsx subprocess (`routedIds` is injected).
 *
 * Run: `node evals/test-rescore.mjs`
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRaw, readRaw, rawPathFor, assertNotFrozen, HOLDOUT_RAW_WARNING } from './raw.mjs';
import { rescoreRaw, buildRescoredArtifact } from './rescore.mjs';
import { expectedHash, labelHashes } from './provenance.mjs';
import { reconstructRuns, reconstructedHeader, readArtifactAt } from './reconstruct-raw.mjs';
import { loadCases } from './split.mjs';

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
    assert.equal(art.rescoredOffline.originalGitSha, 'abc1234', "the raw header's sha (the run itself), not the artifact's");
    assert.match(art.rescoredOffline.note, /OFFLINE/);
    assert.equal(art.command, 'orig cmd');
    assert.equal(art.gitSha, 'new');
    assert.equal(art.mode, 'pass-rate');
    assert.ok(art.perRunMetrics && art.extendedMetrics && art.cases);
  }));


// ─── rescore robustness ─────────────────────────────────────────────────────

test('the_rewritten_artifact_records_the_unscored_ids_and_its_provenance', () =>
  withTmp((dir) => {
    const file = write(dir);
    const extra = [...mkCases(), { id: 'later', axis: 'plain', split: 'dev', expected: label(), context: {} }];
    const result = rescoreRaw(file, { cases: extra, thresholds: THRESHOLDS, routedIds: new Set() });
    const art = buildRescoredArtifact(null, result, { reason: 'r', rawRelPath: 'x.jsonl', sha: 's', dirty: false });
    assert.deepEqual(art.rescoredOffline.unscored, ['later']);
    assert.equal(art.caseCount, 3, 'the cases actually scored');
    assert.match(art.datasetLabelSha, /^[0-9a-f]{16}$/);
    assert.equal(art.parsePromptSha, null, 'a raw file without a prompt sha cannot invent one');
    const none = buildRescoredArtifact(null, rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() }), {
      reason: 'r', rawRelPath: 'x.jsonl', sha: 's', dirty: false,
    });
    assert.deepEqual(none.rescoredOffline.unscored, []);
  }));

test('a_run_header_carries_the_parse_prompt_sha_into_the_rescored_artifact', () =>
  withTmp((dir) => {
    const file = write(dir, { extraHeader: { parsePromptSha: 'feedfacefeedface' } });
    const result = rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() });
    const art = buildRescoredArtifact(null, result, { reason: 'r', rawRelPath: 'x', sha: 's', dirty: false });
    assert.equal(art.parsePromptSha, 'feedfacefeedface');
  }));

/** Rewrites a raw file's lines through `edit(lines)` (header = lines[0]). */
function editRaw(file, edit) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  writeFileSync(file, edit(lines).join('\n') + '\n');
  return file;
}

test('readRaw_rejects_a_sparse_run_with_a_clear_error', () =>
  withTmp((dir) => {
    const file = editRaw(write(dir), (lines) => lines.filter((l) => !(l.includes('"run":1') && l.includes('"id":"c2"'))));
    assert.throws(() => readRaw(file), /run 1 does not hold the same cases as run 0 \(sparse run\); missing 1: c2/);
  }));

test('readRaw_rejects_extra_ids_gaps_in_run_indices_duplicates_and_a_samples_mismatch', () => {
  withTmp((dir) => {
    const extra = editRaw(write(dir), (lines) => [...lines, JSON.stringify({ run: 2, id: 'zz', status: 'ok', parse: null })]);
    assert.throws(() => readRaw(extra), /run 2 .*extra 1: zz/);
  });
  withTmp((dir) => {
    const gap = editRaw(write(dir), (lines) => lines.filter((l) => !l.includes('"run":1')));
    assert.throws(() => readRaw(gap), /no lines for run\(s\) 1/);
  });
  withTmp((dir) => {
    const dupe = editRaw(write(dir), (lines) => [...lines, lines[1]]);
    assert.throws(() => readRaw(dupe), /more than once: c1/);
  });
  withTmp((dir) => {
    const short = editRaw(write(dir), (lines) => lines.filter((l) => !l.includes('"run":2')));
    assert.throws(() => readRaw(short), /header says 3 run\(s\) but the file holds 2/);
  });
});

test('rescore_surfaces_the_sparse_run_error_instead_of_scoring_the_gap_as_a_failure', () =>
  withTmp((dir) => {
    const file = editRaw(write(dir), (lines) => lines.filter((l) => !(l.includes('"run":2') && l.includes('"id":"c1"'))));
    assert.throws(() => rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() }), /sparse run/);
  }));

const reconstructed = (cases) => ({
  reconstructed: { from: 'an artifact', lossy: 'label values stand in for right fields' },
  labelHashes: labelHashes(cases),
});

test('rescore_refuses_a_reconstructed_file_when_a_label_hash_changed', () =>
  withTmp((dir) => {
    const file = write(dir, { extraHeader: reconstructed(mkCases('expense')) });
    // Unchanged labels: scores normally.
    const ok = rescoreRaw(file, { cases: mkCases('expense'), thresholds: THRESHOLDS, routedIds: new Set() });
    assert.equal(ok.scored.parseRate, 1);
    // c1's label changed: refuse, naming the case and why.
    assert.throws(
      () => rescoreRaw(file, { cases: mkCases('income'), thresholds: THRESHOLDS, routedIds: new Set() }),
      /label changed since this reconstructed file was built, for 1 case\(s\): c1.*cannot be scored/
    );
  }));

test('rescore_refuses_a_reconstructed_file_that_has_no_label_hashes', () =>
  withTmp((dir) => {
    const file = write(dir, { extraHeader: { reconstructed: { from: 'x' } } });
    assert.throws(() => rescoreRaw(file, { cases: mkCases(), thresholds: THRESHOLDS, routedIds: new Set() }), /no labelHashes/);
  }));

test('a_genuine_raw_file_is_still_rescorable_after_a_label_fix', () =>
  withTmp((dir) => {
    const file = write(dir);
    assert.doesNotThrow(() => rescoreRaw(file, { cases: mkCases('income'), thresholds: THRESHOLDS, routedIds: new Set() }));
  }));

test('expectedHash_is_stable_and_changes_with_any_label_field', () => {
  assert.equal(expectedHash(label()), expectedHash(label()));
  for (const over of [{ amountMinor: 501 }, { sign: 'income' }, { dateISO: '2026-10-03' }, { category: 'x' }, { payee: 'y' }]) {
    assert.notEqual(expectedHash(label(over)), expectedHash(label()), JSON.stringify(over));
  }
});

// ─── frozen baselines are never overwritten ─────────────────────────────────

test('a_run_can_never_write_over_a_frozen_baseline_raw_file', () =>
  withTmp((dir) => {
    assert.throws(() => assertNotFrozen('/x/raw/fm.holdout2.baseline-498d40c.jsonl'), /frozen baseline/);
    assert.doesNotThrow(() => assertNotFrozen('/x/raw/fm.holdout2.jsonl'));
    // Even a split label that would resolve to a frozen name is refused.
    assert.throws(() => write(dir, { engine: 'fm', datasetSplit: 'holdout2.baseline-498d40c' }), /frozen baseline/);
  }));

// ─── reconstruction provenance (evals/reconstruct-raw.mjs) ──────────────────

// The reconstruction is frozen as the baseline copy; fm.holdout2.jsonl is now a real step-2 run.
const RECONSTRUCTED_RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results', 'raw', 'fm.holdout2.baseline-498d40c.jsonl');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('reconstruct_raw_reproduces_the_committed_raw_file_per_case_lines_and_label_hashes', () =>
  withTmp((dir) => {
    const art = readArtifactAt('bde1aeb', 'evals/results/fm.holdout2.json');
    const cases = loadCases('holdout2');
    const file = writeRaw({
      engine: art.engine, model: art.model, datasetSplit: art.datasetSplit, command: art.command, gitSha: art.gitSha,
      runs: reconstructRuns(art, cases), rawDir: dir, extraHeader: reconstructedHeader(art, 'bde1aeb', cases),
    });
    assert.deepEqual(lines(file).slice(1), lines(RECONSTRUCTED_RAW).slice(1), 'per-case lines are byte-identical');
    const committed = JSON.parse(lines(RECONSTRUCTED_RAW)[0]);
    assert.deepEqual(committed.labelHashes, labelHashes(cases), 'the committed header hashes the current labels');
    assert.equal(committed.reconstructed.script, 'evals/reconstruct-raw.mjs');
    // And the committed file is rescorable against today's labels (hashes still match).
    assert.doesNotThrow(() => rescoreRaw(RECONSTRUCTED_RAW, { thresholds: THRESHOLDS, routedIds: new Set() }));
  }));

test('reconstruct_raw_round_trips_against_the_bde1aeb_artifact_under_the_bde1aeb_dataset', async () => {
  const gitShow = (p) => execFileSync('git', ['show', `bde1aeb:${p}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const oldArt = JSON.parse(gitShow('evals/results/fm.holdout2.json'));
  const oldDataset = new Map(gitShow('evals/dataset.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => [c.id, c]));
  const scoreDir = mkdtempSync(path.join(tmpdir(), 'xavier-oldscore-'));
  try {
    writeFileSync(path.join(scoreDir, 'score.mjs'), gitShow('evals/score.mjs'));
    const { scoreCase } = await import(pathToFileURL(path.join(scoreDir, 'score.mjs')).href);
    const runs = reconstructRuns(oldArt, loadCases('holdout2'));
    const passDiffs = [];
    let wrongFieldMismatches = 0;
    for (const c of oldArt.cases) {
      let passes = 0;
      for (let sample = 0; sample < oldArt.samples; sample++) {
        const r = runs[sample].find((x) => x.id === c.id);
        const scored = scoreCase(oldDataset.get(c.id).expected ?? null, r.parse);
        if (scored.overall) passes += 1;
        if (scored.failToParseCase) continue;
        // A sample with no recorded diagnostics was fully right.
        const recorded = (c.sampleDiagnostics?.find((x) => x.sample === sample)?.wrongFields ?? []).map((w) => w.field).sort().join();
        const wrong = Object.entries(scored.fields).filter(([, v]) => v === false).map(([k]) => k).sort().join();
        if (wrong !== recorded && recorded !== 'parse') wrongFieldMismatches += 1;
      }
      if (passes !== c.passes) passDiffs.push(c.id);
    }
    assert.equal(oldArt.cases.length, 89);
    assert.deepEqual(passDiffs, [], 'pass counts per case');
    assert.equal(wrongFieldMismatches, 0, 'wrongFields per sample');
  } finally {
    rmSync(scoreDir, { recursive: true, force: true });
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
