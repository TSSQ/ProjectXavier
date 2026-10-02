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
 * APPEND-ONLY (step 1b.1 QA fix — review B2): the committed `"split"` field
 * is the SOURCE OF TRUTH. A case that already carries a `"split"` in
 * `dataset.jsonl` keeps it, full stop — `assignSplits` below copies it
 * through unchanged, regardless of what other cases exist in the dataset.
 * ONLY a case with NO `"split"` field at all gets a fresh assignment, via a
 * PER-CASE rule (`sha256(id + SPLIT_SEED)` as a fraction < `HOLDOUT_FRACTION`
 * -> holdout) that depends only on that case's own `id` — never on how many
 * other cases share its axis, so adding one new case can never move an
 * existing case between dev and holdout (the bug the reviewer caught:
 * `af-14` flipping dev->holdout purely because new siblings changed its
 * axis's sort order under the old "re-sort every case in the axis" scheme).
 *
 * RULES:
 *   1. Every one of the ORIGINAL 39 cases (hardcoded below, `ORIGINAL_DEV_IDS`
 *      — the dataset as of the step-1a.5 field-order experiment) is forced
 *      `"dev"`, overriding anything else — they already drove a selection
 *      decision, so they can never be a meaningful holdout.
 *   2. A case that already has a committed `"split"` keeps it verbatim.
 *   3. A case with no `"split"` yet is assigned by a pure, per-case rule:
 *      `sha256(id + SPLIT_SEED)` read as a fraction of 1 -> `"holdout"` if
 *      that fraction is < `HOLDOUT_FRACTION` (0.3), else `"dev"`. Two
 *      different cases' assignments can never affect each other.
 *   4. Re-running this script (same dataset, same seed) always reproduces
 *      the exact same assignment — `assignSplits` is a pure function of
 *      `(cases, seed, holdoutFraction, forcedDevIds)`, no randomness, no
 *      clock, no I/O, and (per rule 2) no dependency on sibling cases either.
 *
 * HOLDOUT V2 (`"holdout2"`): a third, hand-assigned split. Every case whose
 *  id starts with `h2-` is forced `"holdout2"` (`HOLDOUT2_ID_PREFIX`), so the
 *  hash rule above never touches it and `--check` flags a hand-move as drift.
 *  It is guarded exactly like `"holdout"` (`isGuardedSplit`): scoring it needs
 *  `--confirm-holdout --purpose=...` and every look is logged. `dev` excludes
 *  it; `all` (= dev + holdout v1) excludes it too: reachable only by explicit
 *  `--split=holdout2`. See README's "Holdout v2".
 *
 * DEV ADDITIONS (`"dv-"` ids): forced `"dev"` the same way, so a case written
 *  to be tuned against can never be hashed into a holdout. See README.
 *
 * Usage:
 *   node evals/split.mjs            # (re)writes dataset.jsonl's "split" field for any
 *                                    # case that doesn't have one yet; prints a per-axis report
 *   node evals/split.mjs --check    # verifies every case has a "split" and no already-assigned
 *                                    # case would be changed; exits non-zero on drift/missing
 *
 * There is deliberately no "run split.mjs to re-sync an existing case"
 * workflow any more — a committed split is never recomputed, only a
 * genuinely new (unassigned) case ever gets a fresh value.
 *
 * SPLIT LOCK (step 1b.1 QA/review fix round — review Major 1). The
 * append-only property above only protects dataset.jsonl's OWN "split"
 * field from being recomputed by this script — nothing previously stopped
 * someone from hand-editing a committed case's `"split"` value directly in
 * the file (e.g. flipping a holdout case to dev to make it tuning-visible),
 * since `--check`'s only drift guard was "did a FORCED-DEV original-39 id
 * get hand-edited away from dev" (`drift`, below). `evals/split-lock.json`
 * (committed, `id -> "dev"|"holdout"`) closes that gap for EVERY assigned
 * case, not just the original 39: `--check` (and `test-split.mjs`) now also
 * fail if any locked case's `dataset.jsonl` split differs from its locked
 * value. A case not yet in the lock is not a mismatch — `main()` (the
 * non-`--check` path) appends every not-yet-locked case's CURRENT split to
 * the lock file, once, the same append-only way a case's own `"split"`
 * field is assigned; an already-locked id's value is never rewritten here. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
export const DATASET_PATH = path.join(__dirname, 'dataset.jsonl');
export const SPLIT_LOCK_PATH = path.join(__dirname, 'split-lock.json');

/** Fixed so a never-before-assigned case always hashes to the same
 *  fraction — never change this for a dataset with any already-committed
 *  splits without a deliberate, documented re-split (it would only affect
 *  cases that still have no "split" field, but change which bucket they'd
 *  land in going forward). */
export const SPLIT_SEED = 'xavier-fm-eval-split-2026-10-01';

/** ~30% of any still-unassigned case becomes holdout — applied PER CASE
 *  (see module doc comment), not per-axis/globally, so one new case's
 *  assignment can never move another case's. */
export const HOLDOUT_FRACTION = 0.3;

/** The exact 39 case ids that existed before the step 1b.1 batch (step
 *  1a.5's field-order experiment ran against all of them) — forced "dev"
 *  forever, never re-evaluated by `assignSplits` regardless of what's
 *  committed for them. */
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

/** Holdout v2 is assigned BY HAND, never by the hash rule: every case whose
 *  id starts with this prefix is `"holdout2"`, forced (like the original 39
 *  are forced `"dev"`), so neither the append-only auto-assignment nor a
 *  hand-edit of the file can move one. */
export const HOLDOUT2_ID_PREFIX = 'h2-';

/** Dev cases added after the original batch (custom-category-vocabulary
 *  cases, step 2 prep) are forced `"dev"` by id prefix, so the hash rule can
 *  never put one in a holdout: they are written specifically to be tuned
 *  against, and a holdout case must not be. */
export const DEV_ADDITION_ID_PREFIX = 'dv-';

/** Every value a case's `split` field may carry. */
export const ASSIGNED_SPLITS = new Set(['dev', 'holdout', 'holdout2']);

/** Splits whose cases must only be scored deliberately: `holdout`,
 *  `holdout2`, and `all` (dev + holdout v1, so it touches holdout). Used by the
 *  look guard, the recorded command, and `evals/fm/replay-orders.mjs`. */
export const GUARDED_SPLITS = new Set(['holdout', 'holdout2', 'all']);
export const isGuardedSplit = (split) => GUARDED_SPLITS.has(split);

export function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** `sha256(id + seed)`'s first 13 hex digits, read as a fraction of 1
 *  (`[0, 1)`) — a pure, per-case, deterministic "random-looking" number with
 *  no dependency on any other case. */
export function fractionFor(id, seed) {
  const hex = sha256Hex(`${id}${seed}`).slice(0, 13);
  return parseInt(hex, 16) / Math.pow(16, 13);
}

/**
 * Pure assignment function: `cases` (each needs at least `id`; a case may
 * optionally already carry `split`) -> `Map<id, 'dev' | 'holdout' | 'holdout2'>`.
 * An `h2-` id is always `'holdout2'` (hand-assigned, see HOLDOUT2_ID_PREFIX). No I/O,
 * no randomness — same inputs always produce the same output.
 *
 * APPEND-ONLY: a case with an existing `split` of `'dev'`/`'holdout'` is
 * copied through verbatim (unless it's a forced-dev original id — rule 1
 * always wins). A case with no `split` yet gets a fresh per-case assignment
 * (`fractionFor`). This means the presence/absence of any OTHER case in
 * `cases` can never change an already-assigned case's result.
 */
export function assignSplits(
  cases,
  { seed = SPLIT_SEED, holdoutFraction = HOLDOUT_FRACTION, forcedDevIds = ORIGINAL_DEV_IDS } = {}
) {
  const result = new Map();
  for (const c of cases) {
    if (forcedDevIds.has(c.id)) {
      result.set(c.id, 'dev');
      continue;
    }
    if (c.id.startsWith(HOLDOUT2_ID_PREFIX)) {
      result.set(c.id, 'holdout2');
      continue;
    }
    if (c.id.startsWith(DEV_ADDITION_ID_PREFIX)) {
      result.set(c.id, 'dev');
      continue;
    }
    if (ASSIGNED_SPLITS.has(c.split)) {
      result.set(c.id, c.split);
      continue;
    }
    result.set(c.id, fractionFor(c.id, seed) < holdoutFraction ? 'holdout' : 'dev');
  }
  return result;
}

/** Loads `dataset.jsonl` AS-IS, no validation — every case, regardless of
 *  whether it has a `split` field yet. This is the tolerant, low-level
 *  loader `split.mjs`'s own `main()`/`--check` and `test-split.mjs` use,
 *  since their whole job is to find/assign/verify `split` fields in the
 *  first place — they must be able to load a case that doesn't have one
 *  yet. Consumers that expect every case to already be split-assigned
 *  should use `loadCases` below instead. */
export function loadRawCases(datasetPath = DATASET_PATH) {
  return readFileSync(datasetPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** The splits the `'all'` pseudo-split spans: dev + holdout (v1) ONLY.
 *  `holdout2` is deliberately NOT in it — it is reachable only by an explicit
 *  `--split=holdout2`, so every documented all-split number (the 186-case
 *  dataset) stays reproducible and a routine `all` run can never burn a
 *  holdout-v2 look. */
export const ALL_SPLITS = new Set(['dev', 'holdout']);

/** Loads `dataset.jsonl` filtered to one `split`
 *  (`'dev' | 'holdout' | 'holdout2' | 'all'`; `'all'` = dev + holdout v1, see
 *  `ALL_SPLITS`; default `'dev'`, the free-to-look-at split — every caller
 *  already passes its split explicitly, and a forgotten argument should never
 *  silently reach for a guarded split). The single shared definition (review B3) — `run-eval.mjs`
 *  and `evals/fm/replay-orders.mjs` both import this instead of each
 *  carrying their own copy.
 *
 *  Review M6 — a case missing a valid `split` field fails LOUDLY here
 *  (throws), rather than being silently dropped by the split filter below
 *  (which would otherwise just quietly shrink the 'dev'/'holdout' population
 *  by exactly the broken case(s), looking like a normal smaller run instead
 *  of a dataset integrity bug). By the time a real eval run reaches this
 *  function, `evals/split.mjs` should already have assigned every case —
 *  this is the strict, consumer-facing counterpart to `loadRawCases`. */
export function loadCases(split = 'dev', datasetPath = DATASET_PATH) {
  const all = loadRawCases(datasetPath);
  const missing = all.filter((c) => !ASSIGNED_SPLITS.has(c.split));
  if (missing.length > 0) {
    throw new Error(
      `loadCases: ${missing.length} case(s) in ${datasetPath} are missing a valid "split" field ` +
        `(dev|holdout|holdout2): ${missing.map((c) => c.id).join(', ')} — run \`node evals/split.mjs\` to assign them.`
    );
  }
  if (split === 'all') return all.filter((c) => ALL_SPLITS.has(c.split));
  return all.filter((c) => c.split === split);
}

/** Loads `evals/split-lock.json` (`id -> "dev"|"holdout"`) — `{}` if the
 *  file doesn't exist yet (e.g. a first-time local run before it's ever been
 *  written). Tolerant of a missing/unparsable file by design: the lock is a
 *  tamper-evidence record, not a required input — `findLockMismatches`
 *  simply has nothing to check against when it's empty. */
export function loadSplitLock(lockPath = SPLIT_LOCK_PATH) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return {};
  }
}

/** Pure: `cases` (each needs `id`+`split`) vs. `lock` (`id -> split` map) ->
 *  an array of `{ id, locked, actual }` mismatches, one per case whose
 *  CURRENT `dataset.jsonl` split differs from its locked value. A case
 *  absent from `lock` is never a mismatch (it hasn't been locked yet, e.g.
 *  a genuinely new case this run is about to append) — this only catches a
 *  case that WAS locked and has since drifted, i.e. `dataset.jsonl` edited
 *  without touching `split-lock.json`. It does NOT catch co-tampering: if
 *  the dataset and the lock are edited together to agree, this check passes.
 *  Only reviewing the git diff of both files catches that. */
export function findLockMismatches(cases, lock) {
  const mismatches = [];
  for (const c of cases) {
    const locked = lock[c.id];
    if (locked != null && locked !== c.split) {
      mismatches.push({ id: c.id, locked, actual: c.split });
    }
  }
  return mismatches;
}

/** Short HEAD SHA for provenance; `'unknown'` if git is unavailable. Shared
 *  (step 1b.1 QA/review fix round — review X2) by `run-eval.mjs` (the
 *  committed artifact's own `gitSha` field) and `guardAndLogHoldoutLook`
 *  below (the holdout-look log's `gitSha`) — previously each defined its
 *  own copy. */
export function gitSha(repoRoot = REPO_ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: repoRoot }).trim();
  } catch {
    return 'unknown';
  }
}

const HOLDOUT_LOOKS_PATH = path.join(__dirname, 'holdout-looks.json');

/** Review B1 (moved here from run-eval.mjs by review X2 — see that review's
 *  note for WHY: `evals/fm/replay-orders.mjs` could previously run
 *  `--split=holdout`/`--split=all` with no confirmation and no log at all,
 *  a silent back door around the same protection `run-eval.mjs` enforced)
 *  — the one gate that protects the holdout split from casual re-scoring,
 *  shared by every script that can run a case out of `evals/dataset.jsonl`:
 *  ANY run requesting `--split=holdout` must also pass `--confirm-holdout`
 *  (refuses otherwise, before running anything) and a `--purpose=...`
 *  explaining why this look is happening, which is appended to
 *  `evals/holdout-looks.json` (date, gitSha, purpose, engine, command) — a
 *  durable, committed record of every deliberate look, so "how many times
 *  has holdout actually been scored, and why" is answerable by reading a
 *  file, not by trusting memory. Exits the process directly on a missing
 *  confirmation/purpose — never silently proceeds.
 *
 *  THE LOOK IS LOGGED BEFORE THE ENGINE EVER RUNS (deliberate — review
 *  X2's "crashed/skipped run still counts" note): a run that goes on to
 *  crash, error, or report every case `skipped` (e.g. FM_PROBE_PATH unset)
 *  still counts as a logged look. This is intentionally conservative —
 *  "did we deliberately decide to look at holdout just now" is answered by
 *  whether `--confirm-holdout --purpose=...` was passed and accepted, not
 *  by whether the run subsequently produced a usable score. A human
 *  auditing `holdout-looks.json` should never have to guess whether a
 *  failed run "used up" a look; it did, the same as a successful one. */
export function guardAndLogHoldoutLook({ split, confirmHoldout, purpose, engine, command }) {
  // 'all' ALSO touches every holdout (v1) case (dev + holdout) —
  // the guard must fire for it too, not just a literal `--split=holdout`,
  // or a plain `--split=all` run would be a silent back door around the
  // whole protection this function exists for.
  if (!isGuardedSplit(split)) return;
  if (!confirmHoldout || !purpose) {
    console.error(
      `\neval: --split=${split} touches a holdout split and refuses to run without BOTH\n` +
        '--confirm-holdout and --purpose="...". The holdout split exists to be scored rarely and\n' +
        'deliberately (see evals/README.md\'s "Holdout discipline") — pass both flags only when this\n' +
        'is a real, recorded look, e.g.:\n' +
        '  npm run eval:fm:holdout -- --purpose="step 1b.1 re-baseline, input/label-fix re-run"\n' +
        '  node evals/run-eval.mjs --engine=fm --n=2 --split=all --confirm-holdout --purpose="..."'
    );
    process.exit(1);
  }
  let log = [];
  try {
    log = JSON.parse(readFileSync(HOLDOUT_LOOKS_PATH, 'utf8'));
  } catch {
    log = [];
  }
  log.push({
    date: new Date().toISOString(),
    gitSha: gitSha(),
    engine,
    command,
    purpose,
  });
  writeFileSync(HOLDOUT_LOOKS_PATH, JSON.stringify(log, null, 2) + '\n');
  console.log(`\neval: holdout look recorded in ${path.relative(REPO_ROOT, HOLDOUT_LOOKS_PATH)} — purpose: "${purpose}"`);
}

/** The only valid `--split` values, shared (review B3) by
 *  `run-eval.mjs` and `evals/fm/replay-orders.mjs`. */
export const VALID_SPLITS = new Set(['dev', 'holdout', 'holdout2', 'all']);

/** Strictly parses a `--split` flag out of `argv`, accepting BOTH
 *  `--split=dev` and `--split dev` forms (review B3 — previously
 *  `run-eval.mjs` only parsed the `=` form, so `--split dev` silently fell
 *  through to the default and ran every case). Returns
 *  `{ split, rest }`: `split` is the resolved value (`options.default` if
 *  no `--split` flag was present at all), and `rest` is `argv` with the
 *  `--split` flag (and, for the two-token form, its value) removed, so a
 *  caller can go on to parse its OWN remaining flags and reject anything it
 *  doesn't recognize. Throws (never silently falls back) on an invalid
 *  split value, e.g. a typo. */
export function parseSplitArg(argv, { default: defaultSplit = 'dev' } = {}) {
  let split = defaultSplit;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--split') {
      split = argv[++i];
    } else if (arg.startsWith('--split=')) {
      split = arg.slice('--split='.length);
    } else {
      rest.push(arg);
    }
  }
  if (!VALID_SPLITS.has(split)) {
    throw new Error(`--split must be one of dev|holdout|holdout2|all (got "${split}")`);
  }
  return { split, rest };
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
    const entry = byAxis.get(c.axis) ?? { dev: 0, holdout: 0, holdout2: 0 };
    entry[assignment.get(c.id)] += 1;
    byAxis.set(c.axis, entry);
  }
  return byAxis;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const cases = loadRawCases();
  const assignment = assignSplits(cases);
  const lock = loadSplitLock();

  // Because assignSplits copies an already-committed split through verbatim,
  // "drift" can only ever mean a forced-dev original id was hand-edited to
  // something else in the file — a real, worth-catching mistake. The other
  // half of the guard, `missing`, catches a case that was added to the file
  // but never run through this script at all. `lockMismatches` (review
  // Major 1) catches the gap neither of those two close: hand-flipping ANY
  // OTHER (non-original-39) case's committed split, e.g. moving a holdout
  // case to dev — see evals/split-lock.json's own doc comment above.
  const drift = cases.filter((c) => c.split !== undefined && c.split !== assignment.get(c.id));
  const missing = cases.filter((c) => c.split === undefined);
  const lockMismatches = findLockMismatches(cases, lock);

  if (checkOnly) {
    if (drift.length > 0 || missing.length > 0 || lockMismatches.length > 0) {
      console.error(
        `split check: FAIL — ${drift.length} case(s) drifted from the committed/computed split, ` +
          `${missing.length} case(s) missing a "split" field, ${lockMismatches.length} case(s) ` +
          `drifted from the committed split lock (evals/split-lock.json).`
      );
      for (const c of drift) console.error(`  drift: ${c.id} (file: ${c.split}, computed: ${assignment.get(c.id)})`);
      for (const c of missing) console.error(`  missing: ${c.id} — run \`node evals/split.mjs\` to assign it.`);
      for (const m of lockMismatches) {
        console.error(`  lock mismatch: ${m.id} (locked: ${m.locked}, dataset.jsonl: ${m.actual})`);
      }
      process.exit(1);
    }
    console.log('split check: PASS — every case has a split, none drifted, and none violates the split lock.');
    return;
  }

  const lines = cases.map((c) => JSON.stringify(withSplitField(c, assignment.get(c.id))));
  writeFileSync(DATASET_PATH, lines.join('\n') + '\n');

  // Append every not-yet-locked case's CURRENT split to the lock, once —
  // same append-only convention as a case's own "split" field (review Major
  // 1). An already-locked id is never touched here, even if (per
  // `lockMismatches` above) it has drifted — fixing a real drift is a
  // deliberate, separate act, never silently "resolved" by overwriting the
  // lock to match whatever dataset.jsonl currently says.
  const lockedBefore = loadSplitLock();
  const newlyLocked = { ...lockedBefore };
  let lockAdditions = 0;
  for (const c of cases) {
    if (lockedBefore[c.id] == null) {
      newlyLocked[c.id] = assignment.get(c.id);
      lockAdditions += 1;
    }
  }
  if (lockAdditions > 0) {
    const sorted = Object.fromEntries(Object.keys(newlyLocked).sort().map((id) => [id, newlyLocked[id]]));
    writeFileSync(SPLIT_LOCK_PATH, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`split: locked ${lockAdditions} new case(s) into ${path.relative(REPO_ROOT, SPLIT_LOCK_PATH)}.`);
  }

  const totalHoldout = [...assignment.values()].filter((v) => v === 'holdout').length;
  const totalHoldout2 = [...assignment.values()].filter((v) => v === 'holdout2').length;
  const totalDev = [...assignment.values()].filter((v) => v === 'dev').length;
  console.log(`split: wrote ${cases.length} cases — dev ${totalDev}, holdout ${totalHoldout}, holdout2 ${totalHoldout2}.`);
  console.log('\nPer axis (dev/holdout/holdout2):');
  for (const [axis, { dev, holdout, holdout2 }] of [...axisReport(cases, assignment).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${axis.padEnd(24)} dev ${String(dev).padStart(3)}  holdout ${String(holdout).padStart(3)}  holdout2 ${String(holdout2).padStart(3)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
