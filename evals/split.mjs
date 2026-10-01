#!/usr/bin/env node
/**
 * Dev/holdout split assignment for the parse eval dataset (dev tooling —
 * never ships; see evals/README.md's "Held-out split" section).
 *
 * WHY: the FM field-order experiment (step 1a.5, see README) picked a
 * winning schema-property order using all 39 original cases — making every
 * one of them in-sample for that selection. The next round of tuning needs a
 * split that was never looked at while selecting/labeling, so a final score
 * on it means something. This script assigns every case in
 * `evals/dataset.jsonl` to `"dev"` (selection/tuning — look at this freely)
 * or `"holdout"` (only ever scored once, for a final decision — see
 * README's "holdout discipline").
 *
 * RULES:
 *   1. Every one of the ORIGINAL 39 cases (hardcoded below, `ORIGINAL_DEV_IDS`
 *      — the dataset as of the step-1a.5 field-order experiment) is forced
 *      `"dev"`. They already drove a selection decision, so they can never be
 *      a meaningful holdout.
 *   2. Every other ("new") case is assigned deterministically: within each
 *      `axis` (stratified, so a small axis can't end up all-dev or
 *      all-holdout by chance), new cases are sorted by
 *      `sha256(id + SPLIT_SEED)` and the first `round(count * HOLDOUT_FRACTION)`
 *      (in that sorted order) become `"holdout"`, the rest `"dev"`.
 *   3. Re-running this script (same dataset, same seed) always reproduces the
 *      exact same assignment — `assignSplits` is a pure function of
 *      `(cases, seed, holdoutFraction, forcedDevIds)`, no randomness, no
 *      clock, no I/O.
 *
 * Usage:
 *   node evals/split.mjs            # (re)writes dataset.jsonl's "split" field, prints a per-axis report
 *   node evals/split.mjs --check    # verifies the file already matches the computed assignment (no write); exits non-zero on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = path.join(__dirname, 'dataset.jsonl');

/** Fixed so re-running this script always reproduces the same split — never
 *  change this for an already-committed dataset without a deliberate,
 *  documented re-split (it would silently turn previously-holdout cases into
 *  dev or vice versa). */
export const SPLIT_SEED = 'xavier-fm-eval-split-2026-10-01';

/** ~41% of each axis's NEW (non-original) cases become holdout — chosen to
 *  land close to the ~45-case holdout target across the new ~111-case batch
 *  (see evals/README.md). Applied per-axis (stratified), not globally, so a
 *  small axis isn't accidentally all-dev or all-holdout. */
export const HOLDOUT_FRACTION = 0.41;

/** The exact 39 case ids that existed before this batch (step 1a.5's field-
 *  order experiment ran against all of them) — forced "dev" forever, never
 *  re-evaluated by `assignSplits` regardless of axis/seed/fraction. */
export const ORIGINAL_DEV_IDS = new Set([
  'plain-01', 'plain-02', 'payee-01', 'payee-02', 'relative-01', 'relative-02',
  'relative-03', 'relative-04', 'ambiguous-date-01', 'absolute-01', 'absolute-02',
  'income-01', 'income-02', 'income-03', 'income-04', 'refund-01', 'refund-02',
  'large-01', 'eu-decimal-01', 'currency-word-01', 'currency-symbol-01',
  'multiword-category-01', 'ambiguous-01', 'ambiguous-02', 'transfer-01',
  'transfer-02', 'category-01', 'category-02', 'fail-01', 'fail-02', 'fail-03',
  'fail-04', 'fail-05', 'fail-06', 'fail-07', 'terse-01', 'terse-02', 'terse-03',
  'terse-04',
]);

export function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Pure assignment function: `cases` (each needs at least `id`/`axis`) ->
 * `Map<id, 'dev' | 'holdout'>`. No I/O, no randomness — same inputs always
 * produce the same output (the "split stability" property README/tests rely
 * on).
 */
export function assignSplits(
  cases,
  { seed = SPLIT_SEED, holdoutFraction = HOLDOUT_FRACTION, forcedDevIds = ORIGINAL_DEV_IDS } = {}
) {
  const byAxis = new Map();
  for (const c of cases) {
    const list = byAxis.get(c.axis) ?? [];
    list.push(c);
    byAxis.set(c.axis, list);
  }

  const result = new Map();
  for (const list of byAxis.values()) {
    const forced = list.filter((c) => forcedDevIds.has(c.id));
    const eligible = list.filter((c) => !forcedDevIds.has(c.id));
    for (const c of forced) result.set(c.id, 'dev');

    const sorted = [...eligible].sort((a, b) =>
      sha256Hex(`${a.id}${seed}`).localeCompare(sha256Hex(`${b.id}${seed}`))
    );
    const holdoutCount = Math.round(sorted.length * holdoutFraction);
    sorted.forEach((c, i) => result.set(c.id, i < holdoutCount ? 'holdout' : 'dev'));
  }
  return result;
}

export function loadCases(datasetPath = DATASET_PATH) {
  return readFileSync(datasetPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Rewrites each case with `split` inserted right after `axis` (field order
 *  only — JSON semantics don't care, but keeps the file diff-friendly and
 *  matches how a reader scans a line: id, axis, split, then the rest). */
function withSplitField(c, split) {
  const { id, axis, ...rest } = c;
  return { id, axis, split, ...rest };
}

function axisReport(cases, assignment) {
  const byAxis = new Map();
  for (const c of cases) {
    const entry = byAxis.get(c.axis) ?? { dev: 0, holdout: 0 };
    if (assignment.get(c.id) === 'holdout') entry.holdout += 1;
    else entry.dev += 1;
    byAxis.set(c.axis, entry);
  }
  return byAxis;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const cases = loadCases();
  const assignment = assignSplits(cases);

  const drift = cases.filter((c) => c.split !== undefined && c.split !== assignment.get(c.id));
  const missing = cases.filter((c) => c.split === undefined);

  if (checkOnly) {
    if (drift.length > 0 || missing.length > 0) {
      console.error(
        `split check: FAIL — ${drift.length} case(s) drifted from the computed split, ${missing.length} case(s) missing a "split" field.`
      );
      for (const c of drift) console.error(`  drift: ${c.id} (file: ${c.split}, computed: ${assignment.get(c.id)})`);
      for (const c of missing) console.error(`  missing: ${c.id}`);
      process.exit(1);
    }
    console.log('split check: PASS — dataset.jsonl matches the computed assignment.');
    return;
  }

  const lines = cases.map((c) => JSON.stringify(withSplitField(c, assignment.get(c.id))));
  writeFileSync(DATASET_PATH, lines.join('\n') + '\n');

  const totalHoldout = [...assignment.values()].filter((v) => v === 'holdout').length;
  const totalDev = [...assignment.values()].filter((v) => v === 'dev').length;
  console.log(`split: wrote ${cases.length} cases — dev ${totalDev}, holdout ${totalHoldout}.`);
  console.log('\nPer axis (dev/holdout):');
  for (const [axis, { dev, holdout }] of [...axisReport(cases, assignment).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${axis.padEnd(24)} dev ${String(dev).padStart(3)}  holdout ${String(holdout).padStart(3)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
