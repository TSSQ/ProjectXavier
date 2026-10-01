#!/usr/bin/env node
/**
 * Unit tests for evals/split.mjs — the dev/holdout split assignment (dev
 * tooling, never ships). Covers the properties step 1b.1's QA fix (review
 * B2) cares about: a committed split is append-only (never recomputed), a
 * never-before-assigned case gets a pure per-case assignment that can't be
 * perturbed by adding/removing sibling cases, split stability (same seed ->
 * same assignment, every time), and that none of the original 39 cases (the
 * ones already used to pick the FM field order, step 1a.5) can ever land in
 * holdout. Same plain-assert convention as evals/test-score.mjs/
 * evals/test-gates.mjs.
 *
 * Run: `node evals/test-split.mjs` (exits non-zero on any mismatch).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSplits, fractionFor, loadRawCases, ORIGINAL_DEV_IDS, DATASET_PATH } from './split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function makeCases(spec) {
  // spec: [[axis, id, split?], ...] — a tiny synthetic dataset, no real
  // fields needed beyond what assignSplits reads (`id`, optionally `split`).
  return spec.map(([axis, id, split]) => (split ? { axis, id, split } : { axis, id }));
}

// ─── append-only: a committed split is never recomputed ───────────────────

test('a_case_with_an_existing_split_is_copied_through_verbatim', () => {
  const cases = makeCases([
    ['a', 'x1', 'dev'],
    ['a', 'x2', 'holdout'],
  ]);
  const assignment = assignSplits(cases, { forcedDevIds: new Set() });
  assert.equal(assignment.get('x1'), 'dev');
  assert.equal(assignment.get('x2'), 'holdout');
});

test('adding_a_new_case_never_changes_an_existing_assigned_cases_split', () => {
  // The exact bug the reviewer caught (af-14 flipping dev->holdout purely
  // because new siblings changed its axis's sort order under the old
  // per-axis-sort scheme) — reproduced here with a small synthetic dataset
  // and proven gone under the new per-case rule.
  const before = makeCases(Array.from({ length: 10 }, (_, i) => ['a', `c${i}`]));
  const beforeAssignment = assignSplits(before, { forcedDevIds: new Set() });
  // Commit that assignment onto the cases, exactly like evals/split.mjs's
  // main() does when it (re)writes dataset.jsonl.
  const committed = before.map((c) => ({ ...c, split: beforeAssignment.get(c.id) }));

  // Now add several new cases to the SAME axis (the scenario that broke the
  // old per-axis-sort scheme) and re-run assignment.
  const after = [
    ...committed,
    ...Array.from({ length: 5 }, (_, i) => ({ axis: 'a', id: `new${i}` })),
  ];
  const afterAssignment = assignSplits(after, { forcedDevIds: new Set() });

  for (const c of committed) {
    assert.equal(
      afterAssignment.get(c.id),
      c.split,
      `${c.id}'s split must not change when new sibling cases are added`
    );
  }
});

test('a_case_with_no_split_yet_gets_a_fresh_per_case_assignment', () => {
  const cases = makeCases([['a', 'brand-new-case']]);
  const assignment = assignSplits(cases, { forcedDevIds: new Set() });
  assert.ok(['dev', 'holdout'].includes(assignment.get('brand-new-case')));
  assert.equal(
    assignment.get('brand-new-case'),
    fractionFor('brand-new-case', undefined) < 0.3 ? 'holdout' : 'dev'
  );
});

test('the_per_case_assignment_depends_only_on_its_own_id_not_on_sibling_cases', () => {
  const alone = assignSplits(makeCases([['a', 'solo-case']]), { forcedDevIds: new Set() });
  const withSiblings = assignSplits(
    makeCases([
      ['a', 'solo-case'],
      ...Array.from({ length: 20 }, (_, i) => ['a', `sibling${i}`]),
    ]),
    { forcedDevIds: new Set() }
  );
  assert.equal(alone.get('solo-case'), withSiblings.get('solo-case'));
});

// ─── split stability ────────────────────────────────────────────────────────

test('same_seed_same_fraction_gives_the_same_assignment_every_time', () => {
  const cases = makeCases(Array.from({ length: 20 }, (_, i) => ['a', `c${i}`]));
  const opts = { forcedDevIds: new Set(), holdoutFraction: 0.3, seed: 'fixed-seed' };
  const a1 = assignSplits(cases, opts);
  const a2 = assignSplits(cases, opts);
  const a3 = assignSplits(cases, opts);
  for (const c of cases) {
    assert.equal(a1.get(c.id), a2.get(c.id));
    assert.equal(a1.get(c.id), a3.get(c.id));
  }
});

test('a_different_seed_can_produce_a_different_assignment_for_an_unassigned_case', () => {
  const cases = makeCases(Array.from({ length: 20 }, (_, i) => ['a', `c${i}`]));
  const a1 = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.5, seed: 'seed-one' });
  const a2 = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.5, seed: 'seed-two' });
  const diffs = cases.filter((c) => a1.get(c.id) !== a2.get(c.id));
  assert.ok(diffs.length > 0, 'expected at least one case to land differently under a different seed');
});

test('the_committed_dataset_file_already_matches_its_own_computed_assignment', () => {
  // Guards against evals/dataset.jsonl's "split" field drifting from what
  // evals/split.mjs would (re)compute today — the same check `node
  // evals/split.mjs --check` runs, exercised here as a unit test too. Since
  // assignment is now append-only, this is really just "every case has a
  // split, and no original-39 id was hand-edited away from dev".
  const cases = loadRawCases();
  const assignment = assignSplits(cases);
  for (const c of cases) {
    assert.equal(
      c.split,
      assignment.get(c.id),
      `dataset.jsonl's "split" for ${c.id} (${c.split}) does not match the computed assignment (${assignment.get(c.id)}).`
    );
  }
});

test('every_committed_case_has_a_split_field', () => {
  const cases = loadRawCases();
  const missing = cases.filter((c) => c.split === undefined);
  assert.equal(missing.length, 0, `cases missing a "split" field: ${missing.map((c) => c.id).join(', ')}`);
});

// ─── no original-39 case in holdout ─────────────────────────────────────────

test('original_39_ids_are_never_assigned_holdout_regardless_of_axis_seed_or_prior_split', () => {
  // Every original id, spread across a few different axes, with a HIGH
  // holdout fraction and even a (bogus, hand-edited) committed "holdout" —
  // forcedDevIds must win regardless.
  const originalIds = [...ORIGINAL_DEV_IDS];
  const cases = originalIds.map((id, i) => ({ axis: `axis-${i % 4}`, id, split: 'holdout' }));
  for (const seed of ['seed-a', 'seed-b', 'seed-c']) {
    const assignment = assignSplits(cases, { holdoutFraction: 0.9, seed });
    for (const id of originalIds) {
      assert.equal(assignment.get(id), 'dev', `${id} must stay dev under seed ${seed}`);
    }
  }
});

test('original_39_ids_in_the_committed_dataset_are_all_dev', () => {
  const cases = loadRawCases();
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const id of ORIGINAL_DEV_IDS) {
    const c = byId.get(id);
    assert.ok(c, `expected ${id} to still exist in dataset.jsonl`);
    assert.equal(c.split, 'dev', `${id} (one of the original 39) must be "dev"`);
  }
});

test('committed_dataset_has_no_holdout_id_among_the_original_39', () => {
  const cases = loadRawCases();
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
