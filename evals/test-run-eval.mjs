#!/usr/bin/env node
/**
 * Tests for the recorded `command` strings, the committed results artifacts,
 * and the holdout guard of `node evals/run-eval.mjs` (step 1b.1 cleanup).
 *
 * Deliberately NOT in run-eval.mjs's `runScorerSelfTests` list: it spawns
 * run-eval.mjs itself (that would recurse), and it asserts on the artifacts
 * run-eval.mjs rewrites (a stale artifact would block its own regeneration).
 * Run it by hand / in CI: `node evals/test-run-eval.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandFor } from './command.mjs';
import { computePostHoc } from './post-hoc-refusal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const LOOKS_PATH = path.join(__dirname, 'holdout-looks.json');
const RUN_EVAL = path.join(__dirname, 'run-eval.mjs');
const ENGINES = ['heuristic', 'openai', 'anthropic', 'fm'];

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('commandFor_npm_engines_use_the_bare_dashdash_separator', () => {
  for (const engine of ['heuristic', 'openai', 'anthropic']) {
    assert.match(commandFor(engine, 1, 'dev'), / -- --split=dev$/);
  }
});

test('commandFor_holdout_and_all_carry_confirm_and_purpose', () => {
  for (const engine of ENGINES) {
    for (const split of ['holdout', 'holdout2', 'all']) {
      const cmd = commandFor(engine, 2, split, { purpose: 'why' });
      assert.ok(cmd.includes(` --split=${split} --confirm-holdout --purpose="why"`), cmd);
    }
    assert.ok(!commandFor(engine, 2, 'dev', { purpose: 'why' }).includes('--confirm-holdout'));
  }
});

test('commandFor_records_n_for_every_runNTimes_engine', () => {
  assert.equal(commandFor('openai', 3, 'dev'), 'npm run eval:openai -- --n=3 --split=dev');
  assert.equal(commandFor('anthropic', 3, 'dev'), 'npm run eval:cloud -- --n=3 --split=dev');
  assert.equal(commandFor('openai', 1, 'dev'), 'npm run eval:openai -- --split=dev');
  assert.match(commandFor('fm', 2, 'dev'), /--engine=fm --n=2 --split=dev$/);
  assert.equal(commandFor('heuristic', 3, 'dev'), 'npm run eval -- --split=dev');
});

test('every_committed_artifact_command_agrees_with_its_split_and_engine', () => {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const a = readJson(path.join(RESULTS_DIR, f));
    const purpose = a.command.match(/ --purpose="(.*)"$/)?.[1];
    if (a.datasetSplit === 'dev') assert.equal(purpose, undefined, `${f}: dev run carries a purpose`);
    else assert.ok(purpose, `${f}: ${a.datasetSplit} run lacks --confirm-holdout --purpose`);
    // The recorded command must be exactly what commandFor produces today.
    assert.equal(a.command, commandFor(a.engine, a.samples, a.datasetSplit, { purpose }), f);
    assert.ok(a.command.includes(` --split=${a.datasetSplit}`), f);
  }
});

test('heuristic_artifacts_match_baseline_bySplit', () => {
  const baseline = readJson(path.join(__dirname, 'baseline.json'));
  for (const f of ['heuristic.json', 'heuristic.dev.json']) {
    const a = readJson(path.join(RESULTS_DIR, f));
    const b = baseline.bySplit[a.datasetSplit];
    assert.ok(b, `${f}: no baseline.bySplit.${a.datasetSplit}`);
    assert.equal(a.overall.correct, b.counts.overallCorrect, `${f} overall.correct`);
    assert.equal(a.overall.total, b.counts.overallTotal, `${f} overall.total`);
    assert.equal(a.parseCases.correct, b.counts.parseCorrect, `${f} parse.correct`);
    assert.equal(a.failToParse.correct, b.counts.failToParseCorrect, `${f} refusal.correct`);
    for (const [field, counts] of Object.entries(b.fieldCounts)) {
      assert.equal(a.fields[field].correct, counts.correct, `${f} ${field}.correct`);
      assert.equal(a.fields[field].total, counts.total, `${f} ${field}.total`);
    }
  }
});

test('post_hoc_refusal_scores_reliable_cases_and_excludes_routed_from_after_routing', () => {
  const cases = [
    { id: 'a', expected: null, subtype: 'injection' },
    { id: 'b', expected: null, subtype: 'injection' },
    { id: 'c', expected: null },
    { id: 'p', expected: { amountMinor: 1 } },
  ];
  const artifact = {
    perCaseThreshold: 0.6,
    cases: [
      { id: 'a', passes: 2, samples: 2 },
      { id: 'b', passes: 0, samples: 2 },
      { id: 'c', passes: 1, samples: 2 },
      { id: 'p', passes: 0, samples: 2 },
    ],
  };
  const r = computePostHoc(artifact, cases, new Set(['b']));
  assert.deepEqual(r.refusalBySubtype, { injection: { correct: 1, total: 2 }, unspecified: { correct: 0, total: 1 } });
  assert.deepEqual(r.afterRoutingRefusal, { correct: 1, total: 2, routed: 1, rate: 0.5 });
});

for (const split of ['all', 'holdout', 'holdout2']) {
  test(`run_eval_split_${split}_without_confirm_exits_1_and_leaves_looks_untouched`, () => {
    const before = readFileSync(LOOKS_PATH);
    for (const extra of [[], ['--confirm-holdout'], ['--purpose=x']]) {
      const r = spawnSync('node', [RUN_EVAL, `--split=${split}`, ...extra], { encoding: 'utf8' });
      assert.equal(r.status, 1, `${split} ${extra}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /refuses to run without BOTH/);
    }
    assert.ok(readFileSync(LOOKS_PATH).equals(before), 'holdout-looks.json changed');
  });
}

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
