#!/usr/bin/env node
/**
 * Unit tests for evals/split.mjs — the dev/holdout split assignment (dev
 * tooling, never ships). Covers the three properties step 1b.1 cares about:
 * split filtering (a consumer can select dev-only/holdout-only/all), split
 * stability (same seed -> same assignment, every time), and that none of the
 * original 39 cases (the ones already used to pick the FM field order, step
 * 1a.5) can ever land in holdout. Same plain-assert convention as
 * evals/test-score.mjs/evals/test-gates.mjs.
 *
 * Run: `node evals/test-split.mjs` (exits non-zero on any mismatch).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSplits, loadCases, ORIGINAL_DEV_IDS, DATASET_PATH } from './split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function makeCases(spec) {
  // spec: [[axis, id], ...] — a tiny synthetic dataset, no real fields needed
  // beyond what assignSplits reads (`id`, `axis`).
  return spec.map(([axis, id]) => ({ axis, id }));
}

// ─── split filtering ────────────────────────────────────────────────────────

test('assignSplits_returns_a_split_for_every_case', () => {
  const cases = makeCases([['a', 'x1'], ['a', 'x2'], ['b', 'x3']]);
  const assignment = assignSplits(cases, { forcedDevIds: new Set() });
  assert.equal(assignment.size, 3);
  for (const c of cases) assert.ok(['dev', 'holdout'].includes(assignment.get(c.id)));
});

test('a_consumer_can_filter_to_dev_only_or_holdout_only', () => {
  const cases = makeCases(Array.from({ length: 10 }, (_, i) => ['a', `c${i}`]));
  const assignment = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.4 });
  const dev = cases.filter((c) => assignment.get(c.id) === 'dev');
  const holdout = cases.filter((c) => assignment.get(c.id) === 'holdout');
  assert.equal(dev.length + holdout.length, cases.length);
  assert.equal(holdout.length, 4); // round(10 * 0.4)
  // No case appears in both.
  const devIds = new Set(dev.map((c) => c.id));
  for (const c of holdout) assert.ok(!devIds.has(c.id));
});

test('holdoutFraction_is_applied_per_axis_not_globally_(stratified)', () => {
  // A 1-case axis and a 9-case axis: a global (non-stratified) 40% cut could
  // leave the small axis with ZERO holdout representation. Stratifying per
  // axis means even the 1-case axis gets its own rounded share.
  const cases = makeCases([
    ['small', 's1'],
    ...Array.from({ length: 9 }, (_, i) => ['big', `b${i}`]),
  ]);
  const assignment = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.4 });
  const bigHoldout = cases.filter((c) => c.axis === 'big' && assignment.get(c.id) === 'holdout');
  assert.equal(bigHoldout.length, 4); // round(9 * 0.4)
  // The small axis's own single case independently resolves to dev or
  // holdout (round(1 * 0.4) === 0, so forced dev) — asserting the computed
  // value proves axes are computed independently, not pooled.
  assert.equal(assignment.get('s1'), 'dev');
});

// ─── split stability ────────────────────────────────────────────────────────

test('same_seed_same_fraction_gives_the_same_assignment_every_time', () => {
  const cases = makeCases(Array.from({ length: 20 }, (_, i) => ['a', `c${i}`]));
  const opts = { forcedDevIds: new Set(), holdoutFraction: 0.41, seed: 'fixed-seed' };
  const a1 = assignSplits(cases, opts);
  const a2 = assignSplits(cases, opts);
  const a3 = assignSplits(cases, opts);
  for (const c of cases) {
    assert.equal(a1.get(c.id), a2.get(c.id));
    assert.equal(a1.get(c.id), a3.get(c.id));
  }
});

test('a_different_seed_can_produce_a_different_assignment', () => {
  const cases = makeCases(Array.from({ length: 20 }, (_, i) => ['a', `c${i}`]));
  const a1 = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.5, seed: 'seed-one' });
  const a2 = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.5, seed: 'seed-two' });
  const diffs = cases.filter((c) => a1.get(c.id) !== a2.get(c.id));
  assert.ok(diffs.length > 0, 'expected at least one case to land differently under a different seed');
});

test('the_committed_dataset_file_already_matches_its_own_computed_assignment', () => {
  // Guards against evals/dataset.jsonl's "split" field drifting from what
  // evals/split.mjs would (re)compute today — the same check `node
  // evals/split.mjs --check` runs, exercised here as a unit test too.
  const cases = loadCases();
  const assignment = assignSplits(cases);
  for (const c of cases) {
    assert.equal(
      c.split,
      assignment.get(c.id),
      `dataset.jsonl's "split" for ${c.id} (${c.split}) does not match the computed assignment (${assignment.get(c.id)}) — run \`node evals/split.mjs\` to re-sync.`
    );
  }
});

// ─── no original-39 case in holdout ─────────────────────────────────────────

test('original_39_ids_are_never_assigned_holdout_regardless_of_axis_or_seed', () => {
  // Every original id, spread across a few different axes, with a HIGH
  // holdout fraction (so if forcing didn't work, they'd almost certainly
  // land in holdout) and several different seeds.
  const originalIds = [...ORIGINAL_DEV_IDS];
  const cases = makeCases(originalIds.map((id, i) => [`axis-${i % 4}`, id]));
  for (const seed of ['seed-a', 'seed-b', 'seed-c']) {
    const assignment = assignSplits(cases, { holdoutFraction: 0.9, seed });
    for (const id of originalIds) {
      assert.equal(assignment.get(id), 'dev', `${id} must stay dev under seed ${seed}`);
    }
  }
});

test('original_39_ids_in_the_committed_dataset_are_all_dev', () => {
  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const id of ORIGINAL_DEV_IDS) {
    const c = byId.get(id);
    assert.ok(c, `expected ${id} to still exist in dataset.jsonl`);
    assert.equal(c.split, 'dev', `${id} (one of the original 39) must be "dev"`);
  }
});

test('committed_dataset_has_no_holdout_id_among_the_original_39', () => {
  const cases = loadCases();
  const holdoutIds = new Set(cases.filter((c) => c.split === 'holdout').map((c) => c.id));
  for (const id of ORIGINAL_DEV_IDS) {
    assert.ok(!holdoutIds.has(id), `${id} (one of the original 39) must never be holdout`);
  }
});

test('DATASET_PATH_points_at_the_real_dataset_file', () => {
  assert.equal(DATASET_PATH, path.join(__dirname, 'dataset.jsonl'));
  // Sanity: the file actually exists and parses.
  const raw = readFileSync(DATASET_PATH, 'utf8');
  assert.ok(raw.split('\n').filter(Boolean).length >= 150);
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
