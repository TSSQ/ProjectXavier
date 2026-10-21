#!/usr/bin/env node
/**
 * Fold on-device `question` corrections into `evals/questions.jsonl` (dev
 * tooling — never ships; see evals/README.md "Questions"). The question-kind
 * counterpart of `fold.mjs`; runs under `tsx` because the answer is
 * recomputed with the app's real tool code.
 *
 * A correction line is the question case shape with `kind: "question"`:
 *
 *   { "kind": "question", "id": "dv-q-…", "text": "food this month?",
 *     "expect": { "intent": "query", "tool": "total_spent",
 *                 "period": "this_month", "filters": ["Food"] },
 *     "context"?: { … the phone's lists … }, "note"?: "…" }
 *
 * No question correction shape existed on main when this was written, so this
 * file DEFINES it; `src/domain/parseCorrection.ts` should emit exactly this
 * (or this file follows whatever it settles on). Folding:
 *   1. Only `kind: "question"` lines are read (`fold.mjs` takes the rest).
 *   2. Every id must start with `dv-q-` (forced dev by questions-split.mjs).
 *   3. The phone's `context` is DROPPED: the answer is scored against the
 *      fixture ledger, never the user's data, so the case gets the fixture
 *      context and its `expect.filters` must name fixture entities — a name
 *      the fixture lacks fails the fold (map it to a fixture name by hand, in
 *      the corrections file). That also keeps the user's payee/account lists
 *      out of the committed dataset.
 *   4. `answerMinor` is recomputed over the fixture; `floor` defaults to
 *      `answer` for a query (set `stand_aside` by hand where the floor should
 *      not serve the shape); `style` is derived from the text.
 *   5. Every case is printed and nothing is written without `--commit-ready`
 *      (the text is the user's own words — redact first). Ids already in
 *      the dataset are skipped. Then: node evals/questions-split.mjs.
 *
 * Usage: npx tsx evals/corrections/fold-questions.mjs [--validate|--commit-ready] <corrections.jsonl>
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestionCases } from '../questions-schema.mjs';
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

export const QUESTION_CORRECTION_KIND = 'question';
export const QUESTION_CORRECTION_ID_PREFIX = 'dv-q-';

export const isQuestionCorrection = (c) => c?.kind === QUESTION_CORRECTION_KIND;

function styleOf(text) {
  const t = text.trim();
  return t.split(/\s+/).length <= 4 || t.endsWith('?') ? 'terse' : 'full';
}

/**
 * Pure (given the ledger): `{ cases, problems }` — the corrections as dataset
 * cases (no split yet), and `[{ id, issues }]` for every line that cannot be
 * folded.
 */
export function questionCorrectionsToCases(corrections, ledger) {
  const problems = [];
  const cases = [];
  const names = new Set([...ledger.categories, ...ledger.payees, ...ledger.accounts].map((e) => e.name));
  for (const c of corrections.filter(isQuestionCorrection)) {
    const issues = [];
    if (typeof c.id !== 'string' || !c.id.startsWith(QUESTION_CORRECTION_ID_PREFIX)) {
      issues.push(`id must start with "${QUESTION_CORRECTION_ID_PREFIX}"`);
    }
    if ('split' in c) issues.push('a correction must not carry a split (questions-split.mjs assigns it)');
    const e = c.expect ?? {};
    for (const f of e.filters ?? []) if (!names.has(f)) issues.push(`filter "${f}" is not a fixture entity — map it to one by hand`);
    if (issues.length) {
      problems.push({ id: c?.id ?? '(no id)', issues });
      continue;
    }
    const query = e.intent === 'query';
    const expect = query
      ? {
          intent: 'query',
          tool: e.tool,
          period: e.period ?? null,
          filters: e.filters ?? [],
          ...(e.series ? { series: true } : {}),
          answerMinor: 0,
          floor: e.floor ?? 'answer',
        }
      : { intent: e.intent, tool: null, period: null, filters: [], answerMinor: null };
    const out = {
      id: c.id,
      style: styleOf(String(c.text ?? '')),
      text: c.text,
      context: contextFromLedger(ledger),
      expect,
      ...(c.note ? { note: c.note } : {}),
    };
    if (query) {
      try {
        out.expect.answerMinor = expectedAnswerMinor(ledger, out);
      } catch (err) {
        problems.push({ id: c.id, issues: [`answer: ${err.message}`] });
        continue;
      }
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
