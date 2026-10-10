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
  // The account this payee was last confirmed on (domain/learnedDefaults.ts).
  defaultAccountId: text('default_account_id'),
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
  // Excluded from every money aggregation while true (see domain/types.ts
  // isCounted); still shown, marked, in transaction lists.
  pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
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
 * Monthly category budgets (docs/design/monthly-budgets-spec.md §3). One row
 * is "this amount applies to this category from `start_month` to `end_month`
 * (inclusive, null = open-ended)"; the row with the latest start covering a
 * month wins (see domain/budgets.ts `budgetFor`). A null `amount` means "no
 * budget" from `start_month`. Months are local 'YYYY-MM'.
 */
export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull(), // a top-level expense category
  amount: integer('amount'), // minor units; null = no budget
  startMonth: text('start_month').notNull(),
  endMonth: text('end_month'),
  createdAt: integer('created_at').notNull(),
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
  engine: text('engine').notNull(), // 'cloud' | 'heuristic' | 'on_device' | 'openai' | 'anthropic' | 'floor' | 'layout'
  outcome: text('outcome').notNull(), // blocked|clarify_missing|clarify_lowconf|confirm|error|answered|no_match|fell_through|refused
  // Ask-Xavier queries (docs/design/ask-xavier-queries-spec.md §5.5) —
  // `intent` distinguishes a query parse from the default expense parse
  // ('query' | null, the latter meaning "the existing expense/account
  // parse — unchanged"); `tool` is which of the 7 query tools answered
  // (null for a non-query row, or when no tool matched). Both content-free
  // (a fixed enum / tool name, never the question text itself).
  intent: text('intent'),
  tool: text('tool'),
  confidenceBucket: integer('confidence_bucket'),
  inputLenBucket: text('input_len_bucket'),
  missingFields: text('missing_fields'),
  nullFields: text('null_fields'),
  // Free-form JSON detail (content-free). Today only `{"fmFallback": "threw"|"invalid"|"unavailable"}`
  // (src/domain/parseMetrics.ts fmFallbackDetail), written on the row of the engine
  // that took over after the on-device tier failed. No migration: the column existed.
  groundingCounts: text('grounding_counts'),
  deviceAiCapable: integer('device_ai_capable'),
  latencyMs: integer('latency_ms'),
  resolved: text('resolved'), // 'saved' | 'discarded' | 'edited' | 'overridden'
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

/**
 * Today's chat with Xavier (docs/design/xavier-daily-chat-spec.md §5). One row
 * per bubble or card, in `seq` order within a local `day_key` ('YYYY-MM-DD').
 * `payload` is JSON validated by zod on write AND read (src/domain/chatMessage.ts);
 * a photo message stores a label only, never the image. Excluded from backups
 * (stripped from the exported image) and cleared by a restore. Index
 * `idx_chat_day (day_key, seq)` lives in migrationPlan.ts.
 */
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  dayKey: text('day_key').notNull(),
  seq: integer('seq').notNull(),
  role: text('role').notNull(), // 'user' | 'xavier'
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(), // 'live' | 'resolved' | 'abandoned' | 'stale'
  dataRevision: integer('data_revision'),
  createdAt: integer('created_at').notNull(),
});
