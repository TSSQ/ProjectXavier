/**
 * Zod schema for `evals/questions.jsonl` (dev tooling — never ships; see
 * evals/README.md "Questions"). One hand-labelled Ask-Xavier question per
 * line. The single definition of a complete label, used by
 * `evals/test-questions.mjs` (every committed case) and by
 * `evals/corrections/fold.mjs` (an on-device `question` correction).
 *
 * `expect.period` is the `PeriodSpec` the executed call should carry AFTER
 * the code's period override (src/domain/periodRange.ts): a token, or
 * `{ kind: 'year', year }`, `{ kind: 'month', year, month }` (month 0-based,
 * as in the code), `{ kind: 'quarter', year, quarter }` (1-4; no such shape in
 * the code yet — a labelled gap), or `null` (net worth "right now", or a
 * non-query case).
 *
 * `expect.filters` are the category / payee / account NAMES that should apply
 * after resolution — several for a union ("food and groceries"), `[]` for
 * none. `expect.answerMinor` is the headline number (see `headlineMinor` in
 * evals/questions-score.mjs) the expected call yields over
 * `evals/questions-ledger.json`; `null` for a non-query case.
 *
 * `expect.floor` says what the no-engine floor (src/domain/queryFloor.ts)
 * should do with a query: `answer` it correctly, or `stand_aside` (return
 * null, so the app gives its honest "I can answer things like…" reply) for a
 * shape the floor deliberately does not serve. A confidently wrong floor
 * answer is never an allowed label.
 *
 * `expect.intent: 'refuse'` means nothing to log and nothing to answer: the
 * expense ladder (which refuses) and the query path's honest "I can answer
 * things like…" reply are both right, as long as no engine answers with a
 * number (`gateRouteOk` / `scoreCase` in evals/questions-score.mjs).
 *
 * `knownGaps` lists a deterministic engine (`gate` | `floor`) this case is
 * KNOWN to fail today, with the reason and where the fix belongs. The
 * deterministic bar (`npm run eval:questions`) passes a known-gap case that
 * fails and FAILS one that passes (a stale gap must be removed), like a strict
 * xfail. Model engines are never gapped: their misses are the measurement.
 */
import { z } from 'zod';

export const INTENTS = ['query', 'expense', 'refuse', 'account'];
export const QUESTION_TOOLS = [
  'total_spent',
  'total_income',
  'spending_by_category',
  'spending_over_time',
  'top_payees',
  'net_worth',
  'search_transactions',
];
export const PERIOD_TOKENS = ['this_month', 'last_month', 'this_week', 'last_week', 'this_year', 'last_year', 'all_time'];
export const DETERMINISTIC_ENGINES = ['gate', 'floor'];

const year = z.number().int().min(1990).max(2100);
export const periodSchema = z.union([
  z.enum(PERIOD_TOKENS),
  z.object({ kind: z.literal('year'), year }).strict(),
  z.object({ kind: z.literal('month'), year, month: z.number().int().min(0).max(11) }).strict(),
  z.object({ kind: z.literal('quarter'), year, quarter: z.number().int().min(1).max(4) }).strict(),
  z.null(),
]);

export const contextSchema = z
  .object({
    categories: z.array(z.object({ name: z.string().min(1), kind: z.enum(['expense', 'income', 'transfer']) })).min(1),
    payees: z.array(z.string().min(1)),
    accounts: z.array(z.string().min(1)).min(1),
    nowISO: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
    currency: z.string().length(3),
  })
  .strict();

const queryExpect = z
  .object({
    intent: z.literal('query'),
    tool: z.enum(QUESTION_TOOLS),
    period: periodSchema,
    filters: z.array(z.string().min(1)),
    series: z.boolean().optional(),
    answerMinor: z.number().int(),
    floor: z.enum(['answer', 'stand_aside']),
  })
  .strict();

const nonQueryExpect = z
  .object({
    intent: z.enum(['expense', 'refuse', 'account']),
    tool: z.null(),
    period: z.null(),
    filters: z.array(z.string()).length(0),
    answerMinor: z.null(),
  })
  .strict();

export const knownGapSchema = z
  .object({ engine: z.enum(DETERMINISTIC_ENGINES), reason: z.string().min(10) })
  .strict();

const baseShape = {
  id: z.string().regex(/^(q|dv-q)-[a-z0-9-]+$/),
  split: z.enum(['dev', 'holdout']),
  style: z.enum(['terse', 'full']),
  text: z.string().min(1),
  context: contextSchema,
  knownGaps: z.array(knownGapSchema).optional(),
  ambiguous: z.boolean().optional(),
  note: z.string().optional(),
};

export const questionCaseSchema = z.union([
  z.object({ ...baseShape, expect: queryExpect }).strict(),
  z.object({ ...baseShape, expect: nonQueryExpect }).strict(),
]);

/** A case before `evals/questions-split.mjs` assigns its split. */
export const unsplitQuestionCaseSchema = z.union([
  z.object({ ...baseShape, split: z.undefined(), expect: queryExpect }).strict(),
  z.object({ ...baseShape, split: z.undefined(), expect: nonQueryExpect }).strict(),
]);

/** `[{ id, issues }]` for every case failing the schema, plus duplicate ids
 *  and duplicate texts (`[]` = all valid). `allowUnsplit` accepts a case with
 *  no `split` yet (a fresh correction). */
export function validateQuestionCases(cases, { allowUnsplit = false } = {}) {
  const problems = [];
  for (const c of cases) {
    const schema = allowUnsplit && c?.split === undefined ? unsplitQuestionCaseSchema : questionCaseSchema;
    const r = schema.safeParse(c);
    if (!r.success) {
      problems.push({
        id: c?.id ?? '(no id)',
        issues: r.error.issues.map((i) => `${i.path.join('.') || '(case)'}: ${i.message}`),
      });
    }
  }
  const seenIds = new Set();
  const seenTexts = new Set();
  for (const c of cases) {
    if (seenIds.has(c.id)) problems.push({ id: c.id, issues: ['duplicate id'] });
    seenIds.add(c.id);
    const t = String(c.text ?? '').trim().toLowerCase();
    if (seenTexts.has(t)) problems.push({ id: c.id, issues: [`duplicate text "${c.text}"`] });
    seenTexts.add(t);
  }
  return problems;
}
