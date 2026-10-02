#!/usr/bin/env node
/**
 * Tests for the offline comparison tools: post-hoc-refusal.mjs (scores only
 * the ids an artifact holds) and paired.mjs (exact McNemar between two raw
 * files). No model, no network, no tsx subprocess.
 *
 * Run: `node evals/test-paired.mjs`
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restrictToArtifact, computePostHoc } from './post-hoc-refusal.mjs';
import { mcnemarExact, pairedFromRuns, pairedFromRawFiles } from './paired.mjs';
import { writeRaw } from './raw.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── post-hoc-refusal ───────────────────────────────────────────────────────

const refusal = (id, subtype) => ({ id, axis: 'fail-to-parse', subtype, expected: null });
const parseCase = (id) => ({ id, axis: 'plain', expected: { amountMinor: 1, sign: 'expense', dateISO: '2026-01-01', category: null, payee: null } });

test('post_hoc_scores_only_the_ids_the_artifact_holds_and_reports_the_skipped', () => {
  const artifact = {
    perCaseThreshold: 1,
    cases: [
      { id: 'r1', passes: 1, samples: 1 },
      { id: 'r2', passes: 0, samples: 1 },
      { id: 'p1', passes: 1, samples: 1 },
    ],
  };
  // r3 and p2 are newer than the artifact (it was measured on an older, smaller dataset).
  const current = [refusal('r1', 'gibberish'), refusal('r2', 'gibberish'), refusal('r3', 'gibberish'), parseCase('p1'), parseCase('p2')];
  const { cases, skipped } = restrictToArtifact(artifact, current);
  assert.deepEqual(skipped, ['r3', 'p2']);
  assert.deepEqual(cases.map((c) => c.id), ['r1', 'r2', 'p1']);
  // The unrestricted call is the crash the CLI used to hit.
  assert.throws(() => computePostHoc(artifact, current, new Set()), /no row for case r3/);
  const out = computePostHoc(artifact, cases, new Set(['r2']));
  assert.deepEqual(out.afterRoutingRefusal, { correct: 1, total: 1, routed: 1, rate: 1 });
  assert.deepEqual(out.refusalBySubtype, { gibberish: { correct: 1, total: 2 } });
});

test('post_hoc_skips_nothing_when_the_artifact_holds_every_current_case', () => {
  const artifact = { cases: [{ id: 'r1', passes: 1, samples: 1 }] };
  const { cases, skipped } = restrictToArtifact(artifact, [refusal('r1', 'x')]);
  assert.equal(cases.length, 1);
  assert.deepEqual(skipped, []);
});

// ─── paired.mjs ─────────────────────────────────────────────────────────────

test('mcnemarExact_matches_hand_computed_binomial_tails', () => {
  assert.equal(mcnemarExact(0, 0), 1);
  assert.equal(mcnemarExact(4, 4), 1, 'symmetric: capped at 1');
  assert.equal(mcnemarExact(5, 0), 2 * 0.5 ** 5);
  assert.equal(mcnemarExact(0, 5), 2 * 0.5 ** 5, 'direction does not change p');
  assert.equal(mcnemarExact(7, 0), 2 * 0.5 ** 7);
  // n = 18, k = 5: P(X <= 5) = 1 + 18 + 153 + 816 + 3060 + 8568 = 12616 / 2^18.
  assert.ok(Math.abs(mcnemarExact(13, 5) - (2 * 12616) / 2 ** 18) < 1e-12);
  assert.equal(mcnemarExact(1, 0), 1);
});

const ok = (id, over = {}) => ({ id, status: 'ok', parse: { amount: 1, type: 'expense', occurredAt: Date.parse('2026-01-01T12:00:00Z'), category: null, payee: null, ...over } });
const right = (id) => ok(id);
const wrongAmount = (id) => ok(id, { amount: 2 });
const nothing = (id) => ({ id, status: 'ok', parse: null });
const PAIR_CASES = [parseCase('p1'), parseCase('p2'), parseCase('p3'), refusal('r1', 'x'), refusal('r2', 'x')];

test('pairedFromRuns_counts_wins_and_losses_per_metric_in_the_right_direction', () => {
  // baseline: p1 right, p2 wrong, p3 right, r1 refused, r2 answered (wrong)
  const A = [[right('p1'), wrongAmount('p2'), right('p3'), nothing('r1'), right('r2')]];
  // candidate: p1 right, p2 right (win), p3 wrong (loss), r1 answered (loss), r2 refused (win)
  const B = [[right('p1'), right('p2'), wrongAmount('p3'), right('r1'), nothing('r2')]];
  const rows = pairedFromRuns(PAIR_CASES, A, B, 0.6);
  assert.deepEqual([rows.parse.wins, rows.parse.losses, rows.parse.both, rows.parse.n], [1, 1, 1, 3]);
  assert.deepEqual([rows.ledgerCorrect.wins, rows.ledgerCorrect.losses], [1, 1]);
  assert.deepEqual([rows.refusal.wins, rows.refusal.losses, rows.refusal.n], [1, 1, 2]);
  assert.equal(rows.parse.p, 1);
});

test('pairedFromRuns_ledgerCorrect_ignores_a_wrong_category_but_parse_does_not', () => {
  const cases = [{ ...parseCase('p1'), expected: { ...parseCase('p1').expected, category: 'Food' } }];
  const rows = pairedFromRuns(cases, [[ok('p1', { category: 'Food' })]], [[ok('p1', { category: 'Other' })]], 0.6);
  assert.deepEqual([rows.parse.wins, rows.parse.losses], [0, 1], 'category wrong -> parse lost');
  assert.deepEqual([rows.ledgerCorrect.wins, rows.ledgerCorrect.losses], [0, 0], 'ledger fields are all still right');
});

test('pairedFromRuns_reliable_means_right_in_at_least_perCase_of_runs_and_an_error_is_a_failure', () => {
  const cases = [parseCase('p1')];
  const mostly = [[right('p1')], [right('p1')], [wrongAmount('p1')]]; // 2/3 = 0.667
  const half = [[right('p1')], [wrongAmount('p1')]]; // 0.5
  const errored = [[{ id: 'p1', status: 'error', error: 'boom', parse: null }]];
  assert.equal(pairedFromRuns(cases, half, mostly, 0.6).parse.wins, 1, '0.667 >= 0.6 > 0.5');
  assert.equal(pairedFromRuns(cases, half, mostly, 0.5).parse.wins, 0, 'both reliable at 0.5');
  assert.equal(pairedFromRuns(cases, errored, mostly, 0.6).parse.wins, 1);
  assert.equal(pairedFromRuns(cases, errored, [[nothing('p1')]], 0.6).parse.losses, 0);
});

test('pairedFromRuns_a_file_against_itself_has_no_wins_losses_or_signal', () => {
  const runs = [[right('p1'), wrongAmount('p2'), nothing('p3'), nothing('r1'), right('r2')]];
  const rows = pairedFromRuns(PAIR_CASES, runs, runs, 0.6);
  for (const m of Object.values(rows)) assert.deepEqual([m.wins, m.losses, m.p], [0, 0, 1]);
});

const withTmp = (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xavier-paired-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const rawFile = (dir, name, runs, over = {}) => {
  const sub = path.join(dir, name);
  return writeRaw({ engine: 'anthropic', model: name, datasetSplit: 'dev', command: 'c', gitSha: 'g', runs, rawDir: sub, ...over });
};

test('pairedFromRawFiles_pairs_the_common_ids_and_refuses_different_splits', () =>
  withTmp((dir) => {
    const a = rawFile(dir, 'a', [[right('p1'), right('p2'), nothing('r1')]]);
    const b = rawFile(dir, 'b', [[right('p1'), wrongAmount('p2'), nothing('r1'), right('p3')]]);
    const cases = [parseCase('p1'), parseCase('p2'), parseCase('p3'), refusal('r1', 'x')];
    const r = pairedFromRawFiles(a, b, { cases, perCase: 0.6 });
    assert.equal(r.paired, 3);
    assert.deepEqual(r.notPaired, { baselineOnly: 0, candidateOnly: 1 }, 'p3 is only in the candidate, so it is reported but not paired');
    assert.deepEqual([r.rows.parse.wins, r.rows.parse.losses], [0, 1]);
    const other = rawFile(dir, 'c', [[right('p1')]], { datasetSplit: 'holdout' });
    assert.throws(() => pairedFromRawFiles(a, other, { cases }), /different splits/);
  }));

test('the_committed_frozen_baselines_compared_with_themselves_give_0_wins_0_losses', () => {
  const rawDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results', 'raw');
  const frozen = readdirSync(rawDir).filter((f) => /\.holdout2\.baseline-[0-9a-f]+\.jsonl$/.test(f));
  assert.deepEqual(frozen.map((f) => f.split('.')[0]).sort(), ['anthropic', 'fm', 'openai']);
  for (const f of frozen) {
    const r = pairedFromRawFiles(path.join(rawDir, f), path.join(rawDir, f));
    assert.equal(r.paired, 89, f);
    for (const m of Object.values(r.rows)) assert.deepEqual([m.wins, m.losses, m.p], [0, 0, 1], f);
  }
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
