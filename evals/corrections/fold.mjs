#!/usr/bin/env node
/**
 * Fold an on-device corrections file into the eval dataset (dev tooling —
 * never ships). See evals/README.md, "On-device corrections".
 *
 * The app's "This parse was wrong" action (src/domain/parseCorrection.ts,
 * src/features/diagnostics/corrections.ts) writes one eval-dataset-shaped
 * case per line — `{ id, axis, text, context, expected, engine? }`, no
 * `split` — to a file the user shares from Settings › Developer. This script
 * takes that file and appends every NEW, VALID case to `evals/dataset.jsonl`:
 *
 *   1. Every line is validated against the REAL dataset schema
 *      (`evals/dataset-schema.mjs`'s `validateCases`, with a provisional
 *      `split: 'dev'` so the required field is present). An invalid line
 *      fails the whole run — nothing is appended — because a half-labelled
 *      case silently scores every engine wrong (the bug the schema exists for).
 *   2. Every id must start with `dv-` (the app's `DEV_ADDITION_ID_PREFIX`),
 *      so `evals/split.mjs` later forces the case into the dev split: a case
 *      written to be tuned against must never be hashed into a holdout.
 *   3. Ids already in the dataset are skipped (re-sharing a file is safe).
 *   4. Lines are appended WITHOUT a `split`; run `node evals/split.mjs` next
 *      to assign (and lock) it, then `node evals/split.mjs --check`.
 *
 * Usage:
 *   node evals/corrections/fold.mjs <parse-corrections.jsonl>            # validate + append
 *   node evals/corrections/fold.mjs --validate <parse-corrections.jsonl> # validate only, print a report, exit 1 on problems
 *   node evals/corrections/fold.mjs --dry-run <parse-corrections.jsonl>  # report what WOULD be appended
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCases } from '../dataset-schema.mjs';
import { DEV_ADDITION_ID_PREFIX, loadRawCases, DATASET_PATH } from '../split.mjs';

export const CORRECTION_AXIS = 'user-correction';

/** Parse a corrections file into cases. Throws on a line that isn't JSON. */
export function readCorrections(text) {
  const cases = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      cases.push(JSON.parse(line));
    } catch {
      throw new Error(`line ${i + 1} is not valid JSON`);
    }
  });
  return cases;
}

/**
 * Pure: `[{ id, issues }]` for every correction that cannot be folded —
 * schema problems (via the real `validateCases`), a non-`dv-` id, a missing
 * `split`-less shape (a correction must NOT carry a split). `[]` = every
 * case may be appended (duplicates are skipped by `newCorrections`, not
 * reported here, so re-sharing a file is safe).
 */
export function foldProblems(corrections) {
  const problems = [];
  const withSplit = corrections.map((c) => ({ ...c, split: 'dev' }));
  for (const p of validateCases(withSplit)) problems.push(p);
  for (const c of corrections) {
    const issues = [];
    if (typeof c.id === 'string' && !c.id.startsWith(DEV_ADDITION_ID_PREFIX)) {
      issues.push(`id must start with "${DEV_ADDITION_ID_PREFIX}" so split.mjs forces it into dev`);
    }
    if ('split' in c) issues.push('a correction must not carry a split (split.mjs assigns it)');
    if (c.axis !== CORRECTION_AXIS) issues.push(`axis must be "${CORRECTION_AXIS}"`);
    if (issues.length) problems.push({ id: c?.id ?? '(no id)', issues });
  }
  return problems;
}

/** Pure: the corrections not already in the dataset, in file order. */
export function newCorrections(corrections, existingIds) {
  return corrections.filter((c) => !existingIds.has(c.id));
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1) {
    console.error('usage: node evals/corrections/fold.mjs [--validate|--dry-run] <parse-corrections.jsonl>');
    return 2;
  }
  const corrections = readCorrections(readFileSync(files[0], 'utf8'));
  const existingIds = new Set(loadRawCases(DATASET_PATH).map((c) => c.id));
  const problems = foldProblems(corrections);
  if (problems.length) {
    console.error(`${problems.length} correction(s) cannot be folded:`);
    for (const p of problems) console.error(`  ${p.id}: ${p.issues.join('; ')}`);
    return 1;
  }
  const fresh = newCorrections(corrections, existingIds);
  const skipped = corrections.length - fresh.length;
  console.log(`${corrections.length} valid correction(s); ${fresh.length} new, ${skipped} already in the dataset.`);
  if (flags.has('--validate') || flags.has('--dry-run')) {
    for (const c of fresh) console.log(`  + ${c.id}  ${JSON.stringify(c.text)}`);
    return 0;
  }
  if (fresh.length === 0) return 0;
  appendFileSync(DATASET_PATH, fresh.map((c) => `${JSON.stringify(c)}\n`).join(''), 'utf8');
  console.log(`Appended ${fresh.length} case(s) to ${path.relative(process.cwd(), DATASET_PATH)}.`);
  console.log('Next: node evals/split.mjs && node evals/split.mjs --check   (assigns + locks their split: dev)');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
