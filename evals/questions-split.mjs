#!/usr/bin/env node
/**
 * Dev/holdout split for `evals/questions.jsonl` (dev tooling — never ships;
 * see evals/README.md "Questions"). The SAME conventions as `evals/split.mjs`,
 * reusing its pure `assignSplits`: append-only (a committed `split` is never
 * recomputed), a per-case `sha256(id + seed)` rule for a new case (~30%
 * holdout), `dv-` ids (on-device corrections) forced dev, and a lock file
 * (`evals/questions-split-lock.json`) so a hand-edited split fails `--check`.
 * Its own seed, so a question id can never collide with a parse case's draw.
 *
 * Usage:
 *   node evals/questions-split.mjs           # assign + lock any case without a split
 *   node evals/questions-split.mjs --check   # exit 1 if a case is missing a split or drifted from the lock
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSplits, findLockMismatches, loadSplitLock } from './split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const QUESTIONS_DATASET_PATH = path.join(__dirname, 'questions.jsonl');
export const QUESTIONS_SPLIT_LOCK_PATH = path.join(__dirname, 'questions-split-lock.json');
export const QUESTIONS_SPLIT_SEED = 'xavier-questions-split-2026-10-21';
export const QUESTION_SPLITS = new Set(['dev', 'holdout']);

export function assignQuestionSplits(cases) {
  const assigned = assignSplits(cases, { seed: QUESTIONS_SPLIT_SEED, forcedDevIds: new Set() });
  for (const [id, split] of assigned) {
    if (!QUESTION_SPLITS.has(split)) throw new Error(`question case ${id}: split ${split} is not dev|holdout`);
  }
  return assigned;
}

function readLines(file) {
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

/** `split` placed right after `id`, so a line reads id, split, then the rest. */
function withSplit(c, split) {
  const { id, split: _old, ...rest } = c;
  return { id, split, ...rest };
}

/** Pure: problems `--check` reports for these cases against this lock. */
export function questionSplitProblems(cases, lock) {
  const problems = [];
  const assigned = assignQuestionSplits(cases);
  for (const c of cases) {
    if (!QUESTION_SPLITS.has(c.split)) problems.push(`${c.id}: missing split`);
    else if (assigned.get(c.id) !== c.split) problems.push(`${c.id}: split ${c.split} but the rule gives ${assigned.get(c.id)}`);
    if (lock[c.id] == null) problems.push(`${c.id}: not in questions-split-lock.json`);
  }
  for (const m of findLockMismatches(cases, lock)) problems.push(`${m.id}: locked ${m.locked}, file says ${m.actual}`);
  return problems;
}

function main(argv) {
  const cases = readLines(QUESTIONS_DATASET_PATH);
  const lock = loadSplitLock(QUESTIONS_SPLIT_LOCK_PATH);
  if (argv.includes('--check')) {
    const problems = questionSplitProblems(cases, lock);
    if (problems.length) {
      console.error(`questions split check: ${problems.length} problem(s)`);
      for (const p of problems) console.error(`  ${p}`);
      return 1;
    }
    const holdout = cases.filter((c) => c.split === 'holdout').length;
    console.log(`questions split check: ${cases.length} cases (${cases.length - holdout} dev, ${holdout} holdout), lock in sync.`);
    return 0;
  }
  const assigned = assignQuestionSplits(cases);
  const out = cases.map((c) => withSplit(c, assigned.get(c.id)));
  writeFileSync(QUESTIONS_DATASET_PATH, out.map((c) => JSON.stringify(c)).join('\n') + '\n');
  let added = 0;
  for (const c of out) {
    if (lock[c.id] == null) {
      lock[c.id] = c.split;
      added++;
    }
  }
  writeFileSync(QUESTIONS_SPLIT_LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
  console.log(`questions split: ${out.length} cases; ${added} newly locked.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
