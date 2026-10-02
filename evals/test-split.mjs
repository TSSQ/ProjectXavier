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
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignSplits,
  fractionFor,
  loadRawCases,
  ORIGINAL_DEV_IDS,
  DATASET_PATH,
  findLockMismatches,
  loadSplitLock,
  SPLIT_LOCK_PATH,
  loadCases,
  parseSplitArg,
  isGuardedSplit,
  HOLDOUT2_ID_PREFIX,
} from './split.mjs';

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

test('the_committed_dataset_matches_the_committed_split_lock', () => {
  // Step 1b.1 QA/review fix round (review Major 1's "nit") — this used to
  // assert `c.split === assignSplits(cases).get(c.id)`, which is CIRCULAR
  // for every already-split case: `assignSplits` (review B2, append-only)
  // literally copies an existing `c.split` straight through as its own
  // "computed" answer (see assignSplits's own rule 2), so this could never
  // fail for ANY committed case regardless of what split.mjs/the dataset
  // say — it was testing nothing. `evals/split-lock.json` is a SEPARATE,
  // independently-maintained source of truth (review Major 1), so comparing
  // dataset.jsonl against IT is a real check: every locked case's committed
  // split must still match what was locked.
  const cases = loadRawCases();
  const lock = loadSplitLock();
  const mismatches = findLockMismatches(cases, lock);
  assert.equal(
    mismatches.length,
    0,
    `case(s) drifted from the committed split lock (${SPLIT_LOCK_PATH}): ` +
      mismatches.map((m) => `${m.id} (locked: ${m.locked}, dataset.jsonl: ${m.actual})`).join(', ')
  );
});

// ─── split lock (review Major 1): tamper detection beyond the original 39 ──

test('findLockMismatches_is_a_noop_when_every_case_matches_its_lock', () => {
  const cases = [
    { id: 'a', split: 'dev' },
    { id: 'b', split: 'holdout' },
  ];
  const lock = { a: 'dev', b: 'holdout' };
  assert.deepEqual(findLockMismatches(cases, lock), []);
});

test('findLockMismatches_catches_a_hand_flipped_non_original_case', () => {
  // The exact scenario review Major 1 names: hand-moving a NON-original
  // case's committed split (e.g. holdout -> dev) previously passed every
  // existing guard silently — `--check`'s only drift check was "did a
  // forced-dev original-39 id get hand-edited away from dev", which never
  // looks at any other case at all.
  const cases = [
    { id: 'a', split: 'dev' },
    { id: 'af-99', split: 'dev' }, // tampered: was locked as "holdout"
  ];
  const lock = { a: 'dev', 'af-99': 'holdout' };
  const mismatches = findLockMismatches(cases, lock);
  assert.equal(mismatches.length, 1);
  assert.deepEqual(mismatches[0], { id: 'af-99', locked: 'holdout', actual: 'dev' });
});

test('findLockMismatches_ignores_a_case_not_yet_in_the_lock', () => {
  // A genuinely new, not-yet-locked case must never be flagged — it hasn't
  // been locked yet, so there's nothing to compare it against.
  const cases = [{ id: 'brand-new', split: 'holdout' }];
  assert.deepEqual(findLockMismatches(cases, {}), []);
});

test('every_id_in_the_committed_dataset_is_in_the_committed_split_lock', () => {
  // The flip side of the lock-mismatch check: every case that's currently
  // assigned a split should also already be locked (split.mjs's `main()`
  // appends any not-yet-locked case on every write) — a case present in
  // dataset.jsonl but absent from split-lock.json would silently bypass
  // tamper detection entirely (findLockMismatches only checks LOCKED ids).
  const cases = loadRawCases();
  const lock = loadSplitLock();
  const unlocked = cases.filter((c) => lock[c.id] == null);
  assert.equal(
    unlocked.length,
    0,
    `case(s) missing from the split lock: ${unlocked.map((c) => c.id).join(', ')} — run \`node evals/split.mjs\`.`
  );
});

test('every_committed_case_has_a_split_field', () => {
  const cases = loadRawCases();
  const missing = cases.filter((c) => c.split === undefined);
  assert.equal(missing.length, 0, `cases missing a "split" field: ${missing.map((c) => c.id).join(', ')}`);
});

// ─── holdout v2 ("holdout2"): hand-assigned, guarded like holdout ─────────

test('h2_ids_are_always_holdout2_whatever_the_file_or_hash_says', () => {
  const cases = [
    { axis: 'a', id: 'h2-x1' },
    { axis: 'a', id: 'h2-x2', split: 'dev' },
    { axis: 'a', id: 'h2-x3', split: 'holdout' },
    { axis: 'a', id: 'h2-x4', split: 'holdout2' },
  ];
  for (const holdoutFraction of [0, 1]) {
    const assignment = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction });
    for (const c of cases) assert.equal(assignment.get(c.id), 'holdout2', c.id);
  }
});

test('auto_assignment_never_produces_holdout2_for_a_non_h2_case', () => {
  const cases = makeCases(Array.from({ length: 200 }, (_, i) => ['a', `n${i}`]));
  const assignment = assignSplits(cases, { forcedDevIds: new Set(), holdoutFraction: 0.5 });
  assert.ok(![...assignment.values()].includes('holdout2'));
});

test('a_hand_moved_h2_case_shows_up_as_drift_and_as_a_lock_mismatch', () => {
  const moved = [{ axis: 'a', id: 'h2-moved', split: 'dev' }];
  // assignSplits says holdout2, the file says dev -> split.mjs --check's `drift`.
  assert.notEqual(assignSplits(moved).get('h2-moved'), moved[0].split);
  assert.deepEqual(findLockMismatches(moved, { 'h2-moved': 'holdout2' }), [
    { id: 'h2-moved', locked: 'holdout2', actual: 'dev' },
  ]);
});

test('committed_holdout2_cases_are_exactly_the_h2_ids_and_all_locked_holdout2', () => {
  const cases = loadRawCases();
  const lock = loadSplitLock();
  const h2 = cases.filter((c) => c.id.startsWith(HOLDOUT2_ID_PREFIX));
  assert.ok(h2.length >= 80, `expected ~80+ holdout2 cases, got ${h2.length}`);
  assert.equal(new Set(h2.map((c) => c.id)).size, h2.length, 'duplicate h2 ids');
  for (const c of h2) {
    assert.equal(c.split, 'holdout2', c.id);
    assert.equal(lock[c.id], 'holdout2', `${c.id} not locked as holdout2`);
  }
  assert.deepEqual(
    cases.filter((c) => c.split === 'holdout2' && !c.id.startsWith(HOLDOUT2_ID_PREFIX)).map((c) => c.id),
    [],
    'a non-h2 case is marked holdout2'
  );
});

test('committed_holdout2_cases_have_the_decision_population_minimums', () => {
  const h2 = loadCases('holdout2');
  const refusals = h2.filter((c) => c.expected === null);
  assert.ok(refusals.length >= 25, `refusals ${refusals.length}`);
  for (const sub of ['gibberish', 'off-topic', 'injection', 'digit-bearing', 'finance-near-miss']) {
    assert.ok(refusals.filter((c) => c.subtype === sub).length >= 5, `subtype ${sub}`);
  }
  const sign = (s) => h2.filter((c) => c.expected?.sign === s).length;
  assert.ok(sign('income') >= 8, 'income');
  assert.ok(sign('transfer') >= 8, 'transfer');
  assert.ok(h2.filter((c) => c.axis === 'sign').length >= 5, 'money to a non-own-account person');
  assert.ok(h2.filter((c) => c.axis === 'amount-format').length >= 12, 'amounts');
  assert.ok(h2.filter((c) => /date$/.test(c.axis)).length >= 8, 'dates');
  assert.ok(h2.every((c) => c.axis), 'every case has an axis');
});

test('loadCases_dev_and_all_exclude_holdout2_and_all_is_dev_plus_holdout', () => {
  const dev = loadCases('dev');
  const all = loadCases('all');
  const h2 = loadCases('holdout2');
  assert.ok(h2.length > 0);
  assert.ok(dev.every((c) => c.split === 'dev'));
  assert.ok(!dev.some((c) => c.id.startsWith('h2-')));
  assert.ok(!all.some((c) => c.split === 'holdout2' || c.id.startsWith('h2-')));
  assert.equal(all.length, dev.length + loadCases('holdout').length);
  assert.equal(all.length + h2.length, loadRawCases().length);
  assert.ok(!loadCases('holdout').some((c) => c.id.startsWith('h2-')));
});

test('loadCases_defaults_to_dev', () => {
  assert.deepEqual(loadCases().map((c) => c.id), loadCases('dev').map((c) => c.id));
});

test('the_all_split_minus_later_dev_additions_is_the_186_case_v1_dataset', () => {
  // README's documented all-split figures are over the 186 cases that existed
  // before holdout v2 (130 dev / 56 holdout). Dev cases added later (ids
  // starting `dv-`) are not in those figures; every OTHER case in `all` must
  // be exactly that 186, so the documented numbers stay reproducible.
  const v1 = loadCases('all').filter((c) => !c.id.startsWith('dv-'));
  assert.equal(v1.length, 186);
  assert.equal(v1.filter((c) => c.split === 'holdout').length, 56);
  assert.equal(v1.filter((c) => c.split === 'dev').length, 130);
});

test('loadCases_rejects_an_unknown_split_value_in_the_file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xavier-split-test-'));
  try {
    const p = path.join(dir, 'd.jsonl');
    writeFileSync(p, JSON.stringify({ id: 'z1', axis: 'a', split: 'holdout3' }) + '\n');
    assert.throws(() => loadCases('all', p), /missing a valid "split"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSplitArg_accepts_holdout2_and_the_guard_covers_it', () => {
  assert.equal(parseSplitArg(['--split=holdout2']).split, 'holdout2');
  assert.equal(parseSplitArg(['--split', 'holdout2']).split, 'holdout2');
  assert.throws(() => parseSplitArg(['--split=holdout3']), /holdout2/);
  for (const s of ['holdout', 'holdout2', 'all']) assert.ok(isGuardedSplit(s), s);
  assert.ok(!isGuardedSplit('dev'));
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

// ─── replay-orders.mjs refuses holdout/all without confirmation (review X2) ─
//
// Integration-style (spawns the real script via `tsx`, no probe needed —
// the guard runs and exits BEFORE FM_PROBE_PATH is ever checked) rather than
// a pure unit test: the whole point is proving the WIRED-UP script refuses,
// not just that `guardAndLogHoldoutLook` itself works in isolation (already
// covered indirectly by evals/run-eval.mjs's own use of it).

const REPO_ROOT = path.resolve(__dirname, '..');
const REPLAY_ORDERS_PATH = path.join(__dirname, 'fm', 'replay-orders.mjs');

function runReplayOrders(extraArgs) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'xavier-replay-orders-test-'));
  const specPath = path.join(tmpDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({ repeats: 1, cases: [] }));
  try {
    const result = {};
    try {
      // Explicitly strip FM_PROBE_PATH from the child's env (never just
      // inherit process.env) — `npm run eval:fm` sets FM_PROBE_PATH for ITS
      // OWN run-eval.mjs invocation, which (via execFileSync's default env
      // inheritance, test-score.mjs -> test-split.mjs -> this spawn) would
      // otherwise silently leak down into this test and make the "no
      // FM_PROBE_PATH" assumption below false whenever this test runs as
      // part of that larger invocation.
      const { FM_PROBE_PATH: _unused, ...envWithoutProbe } = process.env;
      result.stdout = execFileSync('npx', ['tsx', REPLAY_ORDERS_PATH, '--spec', specPath, ...extraArgs], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: envWithoutProbe,
      });
      result.status = 0;
    } catch (e) {
      result.status = e.status;
      result.stderr = e.stderr?.toString() ?? '';
      result.stdout = e.stdout?.toString() ?? '';
    }
    return result;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('replay_orders_refuses_split_holdout_without_confirm_and_purpose', () => {
  const result = runReplayOrders(['--split=holdout']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit');
  assert.match(result.stderr, /refuses to run without BOTH/);
});

test('replay_orders_refuses_split_all_without_confirm_and_purpose', () => {
  // 'all' touches every holdout case too (the unfiltered superset) — the
  // guard must fire for it exactly like a literal --split=holdout.
  const result = runReplayOrders(['--split=all']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit');
  assert.match(result.stderr, /refuses to run without BOTH/);
});

test('replay_orders_refuses_split_holdout2_without_confirm_and_purpose', () => {
  const result = runReplayOrders(['--split=holdout2']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit');
  assert.match(result.stderr, /refuses to run without BOTH/);
});

test('replay_orders_does_not_gate_split_dev', () => {
  // --split=dev (the default) must sail past the holdout guard entirely —
  // it should fail later for an unrelated reason (no FM_PROBE_PATH set in
  // this test environment), never on the holdout-confirmation message.
  const result = runReplayOrders(['--split=dev']);
  assert.notEqual(result.status, 0, 'expected a non-zero exit (no FM_PROBE_PATH)');
  assert.doesNotMatch(result.stderr, /refuses to run without BOTH/);
  assert.match(result.stderr, /FM_PROBE_PATH is not set/);
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
