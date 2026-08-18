import { localDayNoon } from './dates';

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
  /** User-chosen emoji icon. When set, overrides the subtype-derived emoji. */
  icon?: string | null;
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
  /** The scheduled calendar date (local-noon epoch ms) for this series occurrence. */
  occurrenceDate?: number | null;
  /**
   * A pending transaction stays visible in lists (marked) but is excluded from
   * every aggregation — totals, charts, counts, balances, net worth, and the
   * widget summary — until it is un-pended. See `isCounted`.
   */
  pending: boolean;
}

/**
 * True if `tx` should count toward any money aggregation (totals, charts,
 * counts, balances, net worth). The single source of truth for both the
 * pending exclusion AND the future-dated exclusion (docs/design/
 * future-dated-transactions-spec.md) — apply this predicate at every
 * aggregation site rather than re-checking `tx.pending`/`tx.occurredAt` ad
 * hoc.
 *
 * `now` is REQUIRED (no default) and must be injected by the caller, never
 * read via `Date.now()` inside this module (mirrors `CloudParseContext.now`'s
 * convention) — that's what makes a missed caller fail typecheck instead of
 * silently keeping a future-dated row in a total. For an "as of a specific
 * date" calculation (e.g. `accountBalanceAsOf`), pass that bound itself as
 * `now` rather than the wall clock — see balances.ts.
 *
 * The comparison is by local CALENDAR DAY, not by instant. Everything the
 * user sees is day-granular — the ledger groups by local day, the period
 * selector picks days — and recurring occurrences are stored at local NOON
 * (the timezone-stable day identity, see `localDayNoon`). Comparing instants
 * therefore split a single day in half: a Netflix charge posted for today sat
 * under "TODAY" wearing an "Upcoming" pill, and was missing from every
 * balance and total until 12:00, at which point it silently appeared. If it's
 * today, it's today.
 */
export const isCounted = (tx: Transaction, now: number): boolean =>
  !tx.pending && localDayNoon(tx.occurredAt) <= localDayNoon(now);

/**
 * True if `tx` is dated after `now` and not pending — the "Upcoming" chip
 * case (TransactionRow), kept distinct from `pending`'s own chip so a row is
 * never shown with both at once. A transaction can't be "not counted" for
 * both reasons in this predicate's eyes: pending always wins (see
 * `isCounted`), so `isUpcoming` only fires for the future-dating reason.
 *
 * Day-granular for the same reason as `isCounted`, and it must stay the exact
 * complement of it: the chip's whole job is to explain why a visible row is
 * absent from the totals, so a row that counts must never wear it.
 */
export const isUpcoming = (tx: Transaction, now: number): boolean =>
  !tx.pending && localDayNoon(tx.occurredAt) > localDayNoon(now);

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
  /** Epoch ms of the first occurrence (local-noon — see `localDayNoon` in `dates.ts`). */
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
  /** Epoch ms (local-noon) of the most recently auto-posted occurrence. Null = none posted yet. */
  lastPostedAt: number | null;
  /** Total occurrences posted so far (used for count-based end). */
  postedCount: number;
  paused: boolean;
  /** Epoch ms dates (local-noon) that should be skipped on their next due date. */
  skippedDates: number[];
  createdAt: number;
  archived: boolean;
}
