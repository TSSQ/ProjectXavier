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

const baseShape = {
  id: z.string().min(1),
  axis: z.string().min(1),
  text: z.string(),
  context: z.object({}).passthrough(),
  split: z.enum(['dev', 'holdout', 'holdout2']),
};

/** A parse case: `expected` is a complete label. */
const parseCaseSchema = z.object({ ...baseShape, expected: expectedSchema }).passthrough();

/** A refusal case: `expected: null` and a `subtype`. */
const refusalCaseSchema = z
  .object({ ...baseShape, expected: z.null(), subtype: z.string().min(1) })
  .passthrough();

export const caseSchema = z.union([parseCaseSchema, refusalCaseSchema]);

/** `[{ id, issues }]` for every case that fails the schema (`[]` = all valid). */
export function validateCases(cases) {
  const problems = [];
  for (const c of cases) {
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
