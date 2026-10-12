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
 *   4. Each new case is REDACTED (`redactCorrection`): the phone wrote the
 *      user's whole payee and account lists into `context`, and the dataset
 *      is committed — its own rule is "no real personal data". Only the
 *      names the case's text actually mentions (plus its expected payee,
 *      which the case carries anyway) survive, padded with a small generic
 *      filler set so the grounding is never suspiciously short.
 *   5. Every redacted case is PRINTED in full, and nothing is written unless
 *      `--commit-ready` is passed — which the owner passes only after reading
 *      those cases and hand-redacting anything personal still in them (the
 *      user's own `text` above all: a friend's name, an address).
 *   6. `edits` (what the user changed, per field — src/domain/
 *      correctionEdits.ts) is validated but DROPPED before writing: it holds
 *      the user's own before/after values and no scorer reads it. A
 *      DISCARDED draft (`edits.discarded`, `expected: null`) has no ground
 *      truth, so it is validated, counted, and never folded. The edits stay
 *      in the shared corrections file only — the developer screen's view.
 *      Statement-scan rows (engine 'layout') are kept out the same way:
 *      their text is a bank's printed line, not a text engine's input.
 *   7. Lines are appended WITHOUT a `split`; run `node evals/split.mjs` next
 *      to assign (and lock) it, then `node evals/split.mjs --check`.
 *
 * Usage:
 *   node evals/corrections/fold.mjs <file>                  # validate, redact, PRINT every case; writes nothing
 *   node evals/corrections/fold.mjs --commit-ready <file>   # the same, then append (only after reading + redacting)
 *   node evals/corrections/fold.mjs --validate <file>       # validate only, list what is new, exit 1 on problems
 *   node evals/corrections/fold.mjs --dry-run <file>        # same as --validate
 *   --dataset=<path>                                        # fold into another dataset file (tests only)
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCases, editsSchema } from '../dataset-schema.mjs';
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
  const labelled = corrections.filter((c) => !isDiscarded(c));
  const withSplit = labelled.map((c) => ({ ...c, split: 'dev' }));
  for (const p of validateCases(withSplit)) problems.push(p);
  // A discarded draft is never a dataset case, so only its edits are checked.
  for (const c of corrections.filter(isDiscarded)) {
    const r = editsSchema.safeParse(c.edits);
    const issues = r.success ? [] : r.error.issues.map((i) => `edits.${i.path.join('.')}: ${i.message}`);
    if (c.expected !== null) issues.push('a discarded draft must carry expected: null');
    if (issues.length) problems.push({ id: c?.id ?? '(no id)', issues });
  }
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

/** Generic grounding kept alongside the mentioned names — invented or
 *  well-known public brands only, like every hand-written case. */
export const FILLER_PAYEES = ['Grab', 'FairPrice', 'Amazon', 'Netflix', 'Starbucks'];
export const FILLER_ACCOUNTS = ['Wallet', 'Credit Card', 'Savings'];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pure: does `text` mention `name` as a whole word/phrase (case-insensitive)? */
export function mentions(text, name) {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Case-insensitive de-duplication, first spelling wins. */
function uniqueNames(names) {
  const seen = new Set();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Pure: the case with `context.payees` / `context.accounts` cut down to the
 * names its text mentions (plus `expected.payee`, already in the case) and
 * the generic filler set. Everything else is unchanged — the text itself is
 * left for the owner to read and redact by hand (see `main`).
 */
export function redactCorrection(c) {
  const keep = (list) => list.filter((n) => mentions(c.text, n));
  const expectedPayee = c.expected?.payee ? [c.expected.payee] : [];
  return {
    ...c,
    context: {
      ...c.context,
      payees: uniqueNames([...keep(c.context.payees), ...expectedPayee, ...FILLER_PAYEES]),
      accounts: uniqueNames([...keep(c.context.accounts), ...FILLER_ACCOUNTS]),
    },
  };
}

/** A discarded draft — captured for the developer screen, never folded. */
export function isDiscarded(c) {
  return c?.edits?.discarded === true;
}

/** A statement-scan row (engine 'layout'): its text is a bank's printed
 *  line, not words a text engine was given, so it is not a parse case. */
export function isStatementRow(c) {
  return c?.engine === 'layout' || c?.edits?.engine === 'layout';
}

/** Pure: the case as it may be committed — without `edits`. */
export function stripEdits(c) {
  const rest = { ...c };
  delete rest.edits;
  return rest;
}

/** Pure: the corrections not already in the dataset, in file order. */
export function newCorrections(corrections, existingIds) {
  return corrections.filter((c) => !existingIds.has(c.id));
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.startsWith('--dataset=')));
  const datasetArg = argv.find((a) => a.startsWith('--dataset='));
  const datasetPath = datasetArg ? path.resolve(datasetArg.slice('--dataset='.length)) : DATASET_PATH;
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1) {
    console.error(
      'usage: node evals/corrections/fold.mjs [--validate|--dry-run|--commit-ready] <parse-corrections.jsonl>'
    );
    return 2;
  }
  const corrections = readCorrections(readFileSync(files[0], 'utf8'));
  const existingIds = new Set(loadRawCases(datasetPath).map((c) => c.id));
  const problems = foldProblems(corrections);
  if (problems.length) {
    console.error(`${problems.length} correction(s) cannot be folded:`);
    for (const p of problems) console.error(`  ${p.id}: ${p.issues.join('; ')}`);
    return 1;
  }
  const discarded = corrections.filter(isDiscarded).length;
  const statementRows = corrections.filter((c) => !isDiscarded(c) && isStatementRow(c)).length;
  const labelled = corrections.filter((c) => !isDiscarded(c) && !isStatementRow(c));
  const fresh = newCorrections(labelled, existingIds).map((c) => stripEdits(redactCorrection(c)));
  const skipped = labelled.length - fresh.length;
  console.log(`${labelled.length} valid correction(s); ${fresh.length} new, ${skipped} already in the dataset.`);
  if (discarded) console.log(`${discarded} discarded draft(s) kept out — no ground truth to fold.`);
  if (statementRows) console.log(`${statementRows} statement-scan row(s) kept out — not text-parser cases.`);
  if (flags.has('--validate') || flags.has('--dry-run')) {
    for (const c of fresh) console.log(`  + ${c.id}  ${JSON.stringify(c.text)}`);
    return 0;
  }
  if (fresh.length === 0) return 0;
  // Every case, in full, exactly as it would be committed — the payee and
  // account lists are already cut down, but the text is the user's own.
  console.log('\nRead every case below before committing it (payees/accounts already cut down):\n');
  for (const c of fresh) console.log(`${JSON.stringify(c, null, 2)}\n`);
  if (!flags.has('--commit-ready')) {
    console.log(
      'Nothing written. These cases hold the user\'s own words: redact anything personal still in\n' +
        'them (a person\'s name, an address, an account number) in the corrections file, then re-run\n' +
        'with --commit-ready to append them.'
    );
    return 0;
  }
  appendFileSync(datasetPath, fresh.map((c) => `${JSON.stringify(c)}\n`).join(''), 'utf8');
  console.log(`Appended ${fresh.length} case(s) to ${path.relative(process.cwd(), datasetPath)}.`);
  console.log('Next: node evals/split.mjs && node evals/split.mjs --check   (assigns + locks their split: dev)');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
