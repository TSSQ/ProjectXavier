/**
 * Core domain types. These are framework-free (no React Native / Expo imports)
 * so all financial logic can be unit-tested in plain Node.
 *
 * Money is always stored as an INTEGER number of minor units (e.g. cents) to
 * avoid floating-point rounding errors.
 */

export type TransactionType = 'expense' | 'income' | 'transfer';
export type TransactionSource = 'manual' | 'ai' | 'import';

export interface Account {
  id: string;
  name: string;
  /**
   * Free-form, purely cosmetic label (e.g. "savings", "card", "asset"). It is
   * for the user's own grouping/filtering and has NO effect on any computation —
   * net worth is the signed sum of every account's balance regardless of tag.
   */
  tag?: string | null;
  /** e.g. cash, bank, credit_card, loan, investment */
  subtype?: string;
  /** ISO 4217 code, e.g. "USD". Mirrors the app-level currency setting. */
  currency: string;
  /**
   * Balance as a signed asset value, in minor units. A liability you owe on
   * (e.g. a credit card) is simply a negative balance, so it subtracts itself
   * from net worth without needing a special account "type".
   */
  openingBalance: number;
  archived?: boolean;
}

export interface Transaction {
  id: string;
  /** Source account the money moves from/into. */
  accountId: string;
  type: TransactionType;
  /** Positive magnitude in minor units. Direction is derived from `type`. */
  amount: number;
  currency: string;
  categoryId?: string | null;
  payeeId?: string | null;
  /** Destination account for a transfer. */
  transferAccountId?: string | null;
  note?: string | null;
  /** Epoch milliseconds when the transaction happened. */
  occurredAt: number;
  createdAt: number;
  source: TransactionSource;
  receiptRef?: string | null;
  /** The user's original words for an AI-logged entry (drives the assistant
   *  feed's right-side bubble). Null for manual/import entries. */
  sourceText?: string | null;
  /** Set when this transaction was auto-posted from a recurring series. */
  seriesId?: string | null;
  /** The scheduled calendar date (start-of-UTC-day epoch ms) for this series occurrence. */
  occurrenceDate?: number | null;
}

export interface Category {
  id: string;
  name: string;
  kind: TransactionType;
  parentId?: string | null;
  icon?: string | null;
}

export interface Payee {
  id: string;
  name: string;
  /**
   * The category this payee is normally used with. Set from the first
   * transaction that created the payee ("first-used"), and offered as the
   * auto-fill whenever the payee is picked again.
   */
  defaultCategoryId?: string | null;
}

// ─── Recurring transactions ────────────────────────────────────────────────

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'until'; date: number }   // epoch ms — no occurrence after this date
  | { kind: 'count'; n: number };     // stop after N total posted occurrences

export interface RecurrenceRule {
  freq: RecurrenceFrequency;
  /** Every N frequency units (1 = every, 2 = every other, …). */
  interval: number;
  /**
   * For monthly/yearly: day of month (1-31, clamped to last day of month).
   * For weekly: day of week (0 = Sun … 6 = Sat).
   * Derived from the anchor date when not explicitly set.
   */
  byDay?: number | null;
  /** Epoch ms of the first occurrence (start-of-UTC-day). */
  anchor: number;
  end: RecurrenceEnd;
}

/** The transaction fields that every occurrence of a series shares. */
export interface RecurrenceTemplate {
  accountId: string;
  type: TransactionType;
  /** Positive amount in minor units. */
  amount: number;
  currency: string;
  categoryId?: string | null;
  payeeId?: string | null;
  transferAccountId?: string | null;
  note?: string | null;
}

export interface RecurringSeries {
  id: string;
  rule: RecurrenceRule;
  template: RecurrenceTemplate;
  /** Epoch ms (start-of-UTC-day) of the most recently auto-posted occurrence. Null = none posted yet. */
  lastPostedAt: number | null;
  /** Total occurrences posted so far (used for count-based end). */
  postedCount: number;
  paused: boolean;
  /** Epoch ms dates (start-of-UTC-day) that should be skipped on their next due date. */
  skippedDates: number[];
  createdAt: number;
  archived: boolean;
}
