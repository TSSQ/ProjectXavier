#!/usr/bin/env node
/**
 * Fold on-device `question` corrections into `evals/questions.jsonl` (dev
 * tooling — never ships; see evals/README.md "Questions"). The question-kind
 * counterpart of `fold.mjs` (which leaves these lines alone); runs under
 * `tsx` because the answer is recomputed with the app's real tool code.
 *
 * A question correction is what the app's "Wrong answer?" card writes
 * (src/domain/parseCorrection.ts `questionCorrectionCaseSchema`, mirrored by
 * evals/dataset-schema.mjs `questionCaseSchema`): an id starting `dv-uq-`,
 * the text, the phone's context, `expected: null`, and a `question` block
 * with the call that ran, the call the user corrected it to (`corrected`),
 * and `expect` in the query corpus's terms. Folding maps it onto a question
 * case:
 *   tool     `question.expect.expectTool`
 *   period   the corrected call's `period` / `asOf` (what the user re-ran —
 *            also right for `expectPeriod: 'other'`)
 *   filters  `expectCategory` / `expectPayee`, plus the corrected call's
 *            `account`; every name must be a FIXTURE entity (the answer is
 *            scored over evals/questions-ledger.json, never the user's
 *            data) — edit `question.expect` in the corrections file to a
 *            fixture name when it is not
 *   series   the corrected call's `series` (net worth)
 * The phone's `context` is dropped for the fixture's (which also keeps the
 * user's lists out of the repo). A comparison answer (`fromComparison`) is
 * refused: label it by hand. `answerMinor` is recomputed; `floor` defaults to
 * `answer`. Every case is printed and nothing is written without
 * `--commit-ready` (the text is the user's own words — redact first). Ids or
 * texts already in the dataset are skipped. Then: node evals/questions-split.mjs.
 *
 * Usage: npx tsx evals/corrections/fold-questions.mjs [--validate|--commit-ready] <corrections.jsonl>
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestionCases, periodSchema } from '../questions-schema.mjs';
import { questionCaseSchema, isQuestionCase } from '../dataset-schema.mjs';
import {
  QUESTIONS_PATH,
  QUESTIONS_TZ,
  loadQuestionCases,
  loadLedger,
  contextFromLedger,
  expectedAnswerMinor,
} from '../questions-score.mjs';
import { readCorrections } from './fold.mjs';

process.env.TZ = QUESTIONS_TZ;

export const QUESTION_CORRECTION_ID_PREFIX = 'dv-uq-';
export { isQuestionCase };

function styleOf(text) {
  const t = text.trim();
  return t.split(/\s+/).length <= 4 || t.endsWith('?') ? 'terse' : 'full';
}

/**
 * Pure (given the ledger): `{ cases, problems }` — the question corrections
 * among `corrections` as dataset cases (no split yet), and `[{ id, issues }]`
 * for every one that cannot be folded. Lines without a `question` block are
 * ignored (they are fold.mjs's).
 */
export function questionCorrectionsToCases(corrections, ledger) {
  const problems = [];
  const cases = [];
  const names = new Set([...ledger.categories, ...ledger.payees, ...ledger.accounts].map((e) => e.name));
  for (const c of corrections.filter(isQuestionCase)) {
    const id = c?.id ?? '(no id)';
    // A provisional split, as fold.mjs does: the dataset shape requires one.
    const shape = questionCaseSchema.safeParse({ ...c, split: 'dev' });
    if (!shape.success) {
      problems.push({ id, issues: shape.error.issues.map((i) => `${i.path.join('.') || '(case)'}: ${i.message}`) });
      continue;
    }
    const issues = [];
    if (!String(c.id).startsWith(QUESTION_CORRECTION_ID_PREFIX)) issues.push(`id must start with "${QUESTION_CORRECTION_ID_PREFIX}"`);
    if ('split' in c) issues.push('a correction must not carry a split (questions-split.mjs assigns it)');
    const q = c.question;
    if (q.fromComparison) issues.push('a comparison answer: label it by hand (a union / comparison case)');
    const params = q.corrected.params ?? {};
    const tool = q.expect.expectTool;
    const rawPeriod = tool === 'net_worth' ? (params.asOf ?? null) : (params.period ?? 'this_month');
    const period = periodSchema.safeParse(rawPeriod);
    if (!period.success) issues.push(`corrected period ${JSON.stringify(rawPeriod)} is not a period spec`);
    const filters = [q.expect.expectCategory, q.expect.expectPayee, typeof params.account === 'string' ? params.account : null]
      .filter((n) => typeof n === 'string' && n.length > 0);
    for (const f of filters) if (!names.has(f)) issues.push(`filter "${f}" is not a fixture entity — set question.expect to a fixture name by hand`);
    if (issues.length) {
      problems.push({ id, issues });
      continue;
    }
    const out = {
      id: c.id,
      style: styleOf(c.text),
      text: c.text,
      context: contextFromLedger(ledger),
      expect: {
        intent: 'query',
        tool,
        period: period.data,
        filters: [...new Set(filters)],
        ...(tool === 'net_worth' && params.series === true ? { series: true } : {}),
        answerMinor: 0,
        floor: 'answer',
      },
      note: `user correction (engine ${q.engine}; wrong: ${q.dimensions.join(', ') || 'unspecified'})`,
    };
    try {
      out.expect.answerMinor = expectedAnswerMinor(ledger, out);
    } catch (err) {
      problems.push({ id, issues: [`answer: ${err.message}`] });
      continue;
    }
    cases.push(out);
  }
  for (const p of validateQuestionCases(cases, { allowUnsplit: true })) problems.push(p);
  return { cases, problems };
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1) {
    console.error('usage: npx tsx evals/corrections/fold-questions.mjs [--validate|--commit-ready] <corrections.jsonl>');
    return 2;
  }
  const corrections = readCorrections(readFileSync(files[0], 'utf8'));
  const { cases, problems } = questionCorrectionsToCases(corrections, loadLedger());
  if (problems.length) {
    console.error(`${problems.length} question correction(s) cannot be folded:`);
    for (const p of problems) console.error(`  ${p.id}: ${p.issues.join('; ')}`);
    return 1;
  }
  const existing = loadQuestionCases();
  const ids = new Set(existing.map((c) => c.id));
  const texts = new Set(existing.map((c) => c.text.trim().toLowerCase()));
  const fresh = cases.filter((c) => !ids.has(c.id) && !texts.has(c.text.trim().toLowerCase()));
  console.log(`${cases.length} valid question correction(s); ${fresh.length} new.`);
  if (flags.has('--validate') || fresh.length === 0) return 0;
  console.log('\nRead every case below before committing it (the text is the user\'s own words):\n');
  for (const c of fresh) console.log(`${JSON.stringify({ ...c, context: '(fixture context)' }, null, 2)}\n`);
  if (!flags.has('--commit-ready')) {
    console.log('Nothing written. Redact anything personal in the corrections file, then re-run with --commit-ready.');
    return 0;
  }
  appendFileSync(QUESTIONS_PATH, fresh.map((c) => `${JSON.stringify(c)}\n`).join(''), 'utf8');
  console.log(`Appended ${fresh.length} case(s) to ${path.relative(process.cwd(), QUESTIONS_PATH)}.`);
  console.log('Next: node evals/questions-split.mjs && node evals/questions-split.mjs --check');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
