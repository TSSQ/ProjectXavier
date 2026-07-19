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

/** Max length persisted for a transaction's `sourceText` (the raw AI/OCR
 *  utterance attached at save time). Anything longer is truncated in
 *  `buildTransaction` (src/domain/assistant.ts) before it reaches this schema —
 *  otherwise a long receipt scan would fail validation and become permanently
 *  unsaveable. */
export const SOURCE_TEXT_MAX_CHARS = 2000;

/**
 * Truncate `s` to at most `SOURCE_TEXT_MAX_CHARS` UTF-16 code units, the same
 * unit `z.string().max()` counts in (`.length`), so the result always passes
 * `transactionSchema`. A naive `s.slice(0, SOURCE_TEXT_MAX_CHARS)` can split
 * an astral character (e.g. an emoji, which is 2 UTF-16 units — a surrogate
 * pair) exactly at the cut, leaving a lone unpaired high surrogate that
 * corrupts to U+FFFD on persist/round-trip. If the last retained unit is a
 * lone high surrogate, drop it too (slice one unit shorter) rather than
 * slicing by code points — a code-point-based cut could keep 2000 code
 * points containing astral chars and exceed 2000 UTF-16 units, re-throwing.
 */
export function truncateSourceText(s: string): string {
  if (s.length <= SOURCE_TEXT_MAX_CHARS) return s;
  let end = SOURCE_TEXT_MAX_CHARS;
  const lastUnit = s.charCodeAt(end - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    // Lone high surrogate at the cut point — its low surrogate pair was cut
    // off. Drop it so no unpaired surrogate survives.
    end -= 1;
  }
  return s.slice(0, end);
}

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

/** Shared message for the "same account on both sides" self-transfer refine
 *  (transactionSchema and recurrenceTemplateSchema). */
const SELF_TRANSFER_MESSAGE = "A transfer can't use the same account on both sides";

/**
 * A self-transfer (transferAccountId === accountId) is a WRITE-time
 * invariant only — it must reject a *new* create/update/form-save, but must
 * never cause a READ of already-stored data to throw. Build 42 already
 * persisted self-transfer rows (review F2's bug) and existing `.sqlite`/
 * `.json` backups contain them; restoring/reading those must succeed (the
 * row is kept, neutralised by `signedDelta`, and surfaced by the one-time
 * scan for the user to repair). So every schema below is split in two:
 *  - a "base"/read schema — everything EXCEPT the self-transfer refine, used
 *    on every restore/read path (must tolerate legacy self-transfer rows).
 *  - the exported strict schema — base + self-transfer refine, used on every
 *    create/update/form-save path (must reject new self-transfers).
 */
const notSelfTransfer = (t: { accountId: string; transferAccountId?: string | null }) =>
  !t.transferAccountId || t.transferAccountId !== t.accountId;

/** Read/restore-tolerant transaction schema — everything transactionSchema
 *  checks EXCEPT the self-transfer refine. Used by the `.sqlite` restore row
 *  parser (`parseTransactionRow`, src/domain/sqliteBackupRows.ts) so a
 *  pre-existing self-transfer row is imported (not rejected); genuine
 *  corruption (bad amount/type/etc.) still throws exactly as before. */
export const transactionReadSchema = z
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
    sourceText: z.string().max(SOURCE_TEXT_MAX_CHARS).nullable().optional(),
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

/** Write-strict transaction schema — every create/update/form-save path
 *  (src/features/transactions/repository.ts) goes through this one, which
 *  also rejects a self-transfer. */
export const transactionSchema = transactionReadSchema.refine(notSelfTransfer, {
  message: SELF_TRANSFER_MESSAGE,
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

/** A single row of the `settings` key/value table — validated when restoring
 *  a `.sqlite` backup (assessment M3), the same trust boundary as every
 *  other backed-up table. */
export const settingsRowSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
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
  /** The (already guard-checked) proposal that the transaction should open
   *  Pending — see deviceParsePrompt.ts's textHasPendingMarker. Defaults to
   *  false so parses that predate this field (and the heuristic tier, which
   *  never sets it) still validate. */
  pending: z.boolean().default(false),
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

/** Read/restore-tolerant recurrence-template schema — everything
 *  recurrenceTemplateSchema checks EXCEPT the self-transfer refine. Used by
 *  the `.sqlite` restore row parser (`parseRecurringSeriesRow`) and by
 *  `postDueOccurrences` (a self-transfer template reachable via legacy
 *  `.json` restore must not abort posting for every other series). */
export const recurrenceTemplateReadSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  categoryId: z.string().nullable().optional(),
  payeeId: z.string().nullable().optional(),
  transferAccountId: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

/** Write-strict recurrence-template schema — series create/update
 *  (src/features/recurring/repository.ts) goes through this one: a
 *  recurring series must not be able to encode a self-transfer, since it
 *  would mint a new bad row every cycle. Same predicate as
 *  `transactionSchema`'s sibling refine. */
export const recurrenceTemplateSchema = recurrenceTemplateReadSchema.refine(
  notSelfTransfer,
  { message: SELF_TRANSFER_MESSAGE, path: ['transferAccountId'] }
);

/** Read/restore-tolerant series schema (embeds the tolerant template). Used
 *  only by the `.sqlite` restore row parser — see `transactionReadSchema`
 *  for why a read path must never throw on a legacy self-transfer row. */
export const recurringSeriesReadSchema = z.object({
  id: z.string().min(1),
  rule: recurrenceRuleSchema,
  template: recurrenceTemplateReadSchema,
  lastPostedAt: z.number().int().nullable(),
  postedCount: z.number().int().min(0),
  paused: z.boolean(),
  /** `notNull default '[]'` in schema.ts — an old backup missing this column
   *  entirely (pre-migration) should restore as "nothing skipped", not throw. */
  skippedDates: z.array(z.number().int()).default([]),
  createdAt: z.number().int(),
  archived: z.boolean(),
});

/** Write-strict series schema — createSeries/updateSeries go through this
 *  one (embeds the strict template, so a series can never be saved with a
 *  self-transfer template). */
export const recurringSeriesSchema = recurringSeriesReadSchema.extend({
  template: recurrenceTemplateSchema,
});

/** Fields the assistant still needs to ask the user about. */
export function missingFields(parsed: AiParsedExpense): string[] {
  const required: Array<keyof AiParsedExpense> = ['amount', 'type'];
  return required.filter((f) => parsed[f] === null || parsed[f] === undefined);
}
