/**
 * Input validation schemas (zod). Every value crossing a trust boundary —
 * user forms, imported files, and especially AI/OCR output — is validated here
 * before it reaches the database layer.
 *
 * Note: free-text fields (e.g. `note`) intentionally allow arbitrary
 * characters, including SQL-looking strings. We never sanitise by rejecting
 * such text; injection is prevented structurally by parameterised queries
 * (see src/db). Validation is about *shape and type*, not escaping.
 */
import { z } from 'zod';

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  /** Optional, cosmetic only — never used in any calculation. */
  tag: z.string().max(40).nullable().optional(),
  subtype: z.string().max(50).optional(),
  /** User-chosen emoji icon; overrides the subtype-derived emoji when present. */
  icon: z.string().max(16).nullable().optional(),
  currency: z.string().length(3),
  openingBalance: z.number().int(),
  archived: z.boolean().optional(),
});

export const transactionSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    type: z.enum(['expense', 'income', 'transfer']),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    categoryId: z.string().nullable().optional(),
    payeeId: z.string().nullable().optional(),
    transferAccountId: z.string().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    occurredAt: z.number().int(),
    createdAt: z.number().int(),
    source: z.enum(['manual', 'ai', 'import']),
    receiptRef: z.string().nullable().optional(),
    sourceText: z.string().max(2000).nullable().optional(),
    seriesId: z.string().nullable().optional(),
    occurrenceDate: z.number().int().nullable().optional(),
    /** Excluded from every money aggregation while true. Defaults to false so
     *  older payloads (pre-pending) still validate. */
    pending: z.boolean().default(false),
  })
  .refine((t) => t.type !== 'transfer' || !!t.transferAccountId, {
    message: 'A transfer requires a transferAccountId',
    path: ['transferAccountId'],
  })
  .refine((t) => t.type === 'transfer' || !t.transferAccountId, {
    message: 'Only transfers may set a transferAccountId',
    path: ['transferAccountId'],
  });

export const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  kind: z.enum(['expense', 'income', 'transfer']),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
});

export const payeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  defaultCategoryId: z.string().nullable().optional(),
});

/**
 * Shape an LLM is asked to return when parsing a described/scanned expense.
 * Fields are optional so the assistant can ask clarifying questions for any
 * that come back missing or null.
 */
export const aiParsedExpenseSchema = z.object({
  amount: z.number().int().positive().nullable(),
  currency: z.string().length(3).nullable(),
  type: z.enum(['expense', 'income', 'transfer']).nullable(),
  category: z.string().max(60).nullable(),
  payee: z.string().max(100).nullable(),
  /** Name of the account/card the user said they used; resolved to an id later. */
  account: z.string().max(100).nullable().optional(),
  note: z.string().max(2000).nullable(),
  occurredAt: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
});

export type AiParsedExpense = z.infer<typeof aiParsedExpenseSchema>;

// ─── Recurring transactions ────────────────────────────────────────────────

export const recurrenceRuleSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365),
  byDay: z.number().int().min(0).max(31).nullable().optional(),
  anchor: z.number().int(),
  end: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('never') }),
    z.object({ kind: z.literal('until'), date: z.number().int() }),
    z.object({ kind: z.literal('count'), n: z.number().int().min(1).max(9999) }),
  ]),
});

export const recurrenceTemplateSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  categoryId: z.string().nullable().optional(),
  payeeId: z.string().nullable().optional(),
  transferAccountId: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const recurringSeriesSchema = z.object({
  id: z.string().min(1),
  rule: recurrenceRuleSchema,
  template: recurrenceTemplateSchema,
  lastPostedAt: z.number().int().nullable(),
  postedCount: z.number().int().min(0),
  paused: z.boolean(),
  skippedDates: z.array(z.number().int()),
  createdAt: z.number().int(),
  archived: z.boolean(),
});

/** Fields the assistant still needs to ask the user about. */
export function missingFields(parsed: AiParsedExpense): string[] {
  const required: Array<keyof AiParsedExpense> = ['amount', 'type'];
  return required.filter((f) => parsed[f] === null || parsed[f] === undefined);
}
