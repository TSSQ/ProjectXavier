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
