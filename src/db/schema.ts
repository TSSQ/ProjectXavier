/**
 * Drizzle ORM schema for the on-device SQLite database (source of truth).
 * Drizzle emits parameterised statements, which is our structural defence
 * against SQL injection (non-negotiable #4).
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tag: text('tag'), // optional, cosmetic only — never affects net worth
  subtype: text('subtype'),
  icon: text('icon'), // optional user-chosen emoji; overrides subtype-derived icon
  currency: text('currency').notNull(),
  openingBalance: integer('opening_balance').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'expense' | 'income' | 'transfer'
  parentId: text('parent_id'),
  icon: text('icon'),
});

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultCategoryId: text('default_category_id'),
});

/** Single-row-per-key store for app-level preferences (e.g. display currency). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  type: text('type').notNull(), // 'expense' | 'income' | 'transfer'
  amount: integer('amount').notNull(), // minor units
  currency: text('currency').notNull(),
  categoryId: text('category_id'),
  payeeId: text('payee_id'),
  transferAccountId: text('transfer_account_id'),
  note: text('note'),
  occurredAt: integer('occurred_at').notNull(),
  createdAt: integer('created_at').notNull(),
  source: text('source').notNull(), // 'manual' | 'ai' | 'import'
  receiptRef: text('receipt_ref'),
  // The user's original utterance for an AI-logged entry, kept so the assistant
  // feed can show it as the right-side bubble. Null for manual/import entries.
  sourceText: text('source_text'),
  // Recurring series linkage — null for one-off transactions.
  seriesId: text('series_id'),
  // The scheduled calendar date (start-of-UTC-day epoch ms) for this occurrence.
  // May differ from occurredAt if the user edits the date after posting.
  occurrenceDate: integer('occurrence_date'),
});

/** Recurring transaction series. The rule + template drive auto-posting. */
export const recurringSeries = sqliteTable('recurring_series', {
  id: text('id').primaryKey(),
  /** JSON-serialised RecurrenceRule. */
  rule: text('rule').notNull(),
  /** JSON-serialised RecurrenceTemplate. */
  template: text('template').notNull(),
  lastPostedAt: integer('last_posted_at'),
  postedCount: integer('posted_count').notNull().default(0),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  /** JSON-serialised number[] of skipped occurrence dates (epoch ms). */
  skippedDates: text('skipped_dates').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

/**
 * Parse diagnostics — content-free signal about the AI-parse pipeline, used to
 * decide whether the cloud LLM layer is needed (see
 * docs/design/parse-metrics-spec.md). Written only in test builds (gated by
 * METRICS_ENABLED); empty and inert in production. Deliberately excluded from
 * backups. No column holds user content — only buckets, booleans, and field
 * names.
 */
export const parseMetrics = sqliteTable('parse_metrics', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  engine: text('engine').notNull(), // 'cloud' | 'heuristic' | 'on_device'
  outcome: text('outcome').notNull(), // blocked|clarify_missing|clarify_lowconf|confirm|error
  confidenceBucket: integer('confidence_bucket'),
  inputLenBucket: text('input_len_bucket'),
  missingFields: text('missing_fields'),
  nullFields: text('null_fields'),
  groundingCounts: text('grounding_counts'),
  deviceAiCapable: integer('device_ai_capable'),
  latencyMs: integer('latency_ms'),
  resolved: text('resolved'), // 'saved' | 'discarded' | 'edited'
  txId: text('tx_id'),
  payeeSwapped: integer('payee_swapped'),
  edited: integer('edited'),
  editedAmount: integer('edited_amount'),
  editedType: integer('edited_type'),
  editedPayee: integer('edited_payee'),
  editedCategory: integer('edited_category'),
  editedDate: integer('edited_date'),
  amountDeltaBucket: integer('amount_delta_bucket'),
});
