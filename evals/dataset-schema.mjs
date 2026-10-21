/**
 * Zod schema for `evals/dataset.jsonl` cases (dev tooling — never ships).
 *
 * WHY: seven holdout-v2 cases once shipped with an `expected` that had no
 * `sign` key. Both scorers read `expected.sign` by name, so the missing key
 * silently scored every engine's (correct) "expense" as wrong. A label must
 * be complete: this schema is the single definition of "complete", used by
 * `evals/test-dataset-schema.mjs` (over every committed case) and by
 * `evals/score.mjs` (`assertExpectedComplete`, mirrored in `scoring.py`).
 */
import { z } from 'zod';

export const SIGNS = ['expense', 'income', 'transfer'];

export const expectedSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    sign: z.enum(['expense', 'income', 'transfer']),
    dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z.string().nullable(),
    payee: z.string().nullable(),
  })
  .passthrough();

const fieldValue = z.union([z.string(), z.number()]).nullable();
const fieldEdit = z.object({ from: fieldValue, to: fieldValue });

/**
 * The optional `edits` block an on-device correction carries
 * (src/domain/correctionEdits.ts — what the user changed, per field). It is
 * validated here so `evals/corrections/fold.mjs --validate` checks it, but
 * `fold.mjs` drops it before writing a case to `dataset.jsonl`: it holds the
 * user's own before/after values, and no scorer reads it.
 */
export const editsSchema = z
  .object({
    amount: fieldEdit,
    type: fieldEdit,
    category: fieldEdit,
    payee: fieldEdit,
    account: fieldEdit,
    date: fieldEdit,
    note: fieldEdit,
    stage: z.enum(['draft', 'post_save']),
    engine: z.string().min(1).nullable(),
    parseSource: z.string().min(1).nullable(),
    appliedDefaults: z.array(z.string().min(1)),
    refused: z.boolean(),
    discarded: z.boolean(),
  })
  .passthrough();

const baseShape = {
  id: z.string().min(1),
  axis: z.string().min(1),
  text: z.string(),
  context: z.object({}).passthrough(),
  split: z.enum(['dev', 'holdout', 'holdout2']),
  edits: editsSchema.optional(),
};

/** A parse case: `expected` is a complete label. */
const parseCaseSchema = z.object({ ...baseShape, expected: expectedSchema }).passthrough();

/** A refusal case: `expected: null` and a `subtype`. */
const refusalCaseSchema = z
  .object({ ...baseShape, expected: z.null(), subtype: z.string().min(1) })
  .passthrough();

/**
 * The optional `question` block an on-device "Wrong answer" correction
 * carries (src/domain/parseCorrection.ts `questionBlockSchema` — an
 * Ask-Xavier question, not a transaction parse). No question dataset shape
 * existed when it was added, so this is a minimal one: `expect` uses the
 * query corpus's own names (tests/query-corpus.jsonl). A question case has
 * `expected: null` and no `subtype`; it is NOT a refusal case, and no
 * transaction scorer should read it (evals/corrections/fold.mjs should route
 * or skip it — see the PR that added this block).
 */
const toolName = z.enum([
  'total_spent',
  'total_income',
  'spending_by_category',
  'spending_over_time',
  'top_payees',
  'net_worth',
  'search_transactions',
]);
const questionCall = z.object({ tool: toolName, params: z.object({}).passthrough() });
const answerFigure = z.object({ amountMinor: z.number().int().nullable(), items: z.number().int().nonnegative().nullable() });
export const questionSchema = z
  .object({
    engine: z.string().min(1),
    call: questionCall,
    filters: z.array(
      z.object({
        dim: z.enum(['category', 'payee', 'account']),
        term: z.string(),
        how: z.enum(['exact', 'memory', 'fuzzy', 'synonym', 'union', 'none']),
        names: z.array(z.string()),
      })
    ),
    corrected: questionCall,
    dimensions: z.array(z.enum(['tool', 'period', 'filter'])),
    expect: z.object({
      expectTool: toolName,
      expectPeriod: z
        .enum(['this_month', 'last_month', 'this_week', 'last_week', 'this_year', 'last_year', 'all_time', 'other'])
        .nullable(),
      expectCategory: z.string().nullable(),
      expectPayee: z.string().nullable(),
    }),
    answer: z.object({ before: answerFigure, after: answerFigure }),
    fromComparison: z.boolean().optional(),
  })
  .passthrough();

/** A question case: `expected: null` and a `question` block. Exported for
 *  a question dataset to adopt; NOT a member of `caseSchema` — see below. */
export const questionCaseSchema = z
  .object({ ...baseShape, expected: z.null(), question: questionSchema })
  .passthrough();

/** True for an Ask-Xavier question correction. */
export const isQuestionCase = (c) => c?.question !== undefined;

export const caseSchema = z.union([parseCaseSchema, refusalCaseSchema]);

/** `[{ id, issues }]` for every case that fails the schema (`[]` = all valid). */
export function validateCases(cases) {
  const problems = [];
  for (const c of cases) {
    // A question correction is not a transaction dataset case: with
    // `expected: null` the scorers would read it as a refusal, and its
    // `question` block holds names the transaction redaction does not cut.
    // Refused here (loudly) until a question dataset routes it.
    if (isQuestionCase(c)) {
      const shape = questionCaseSchema.safeParse(c);
      problems.push({
        id: c?.id ?? '(no id)',
        issues: [
          'a question correction is not a transaction dataset case — route it to a question dataset (questionCaseSchema)',
          ...(shape.success ? [] : shape.error.issues.map((i) => `${i.path.join('.') || '(case)'}: ${i.message}`)),
        ],
      });
      continue;
    }
    const r = (c?.expected === null ? refusalCaseSchema : parseCaseSchema).safeParse(c);
    if (!r.success) {
      problems.push({
        id: c?.id ?? '(no id)',
        issues: r.error.issues.map((i) => `${i.path.join('.') || '(case)'}: ${i.message}`),
      });
    }
  }
  const seen = new Set();
  for (const c of cases) {
    if (seen.has(c.id)) problems.push({ id: c.id, issues: ['duplicate id'] });
    seen.add(c.id);
  }
  return problems;
}
