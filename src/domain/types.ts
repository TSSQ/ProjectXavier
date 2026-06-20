/**
 * Core domain types. These are framework-free (no React Native / Expo imports)
 * so all financial logic can be unit-tested in plain Node.
 *
 * Money is always stored as an INTEGER number of minor units (e.g. cents) to
 * avoid floating-point rounding errors.
 */

export type AccountType = 'asset' | 'liability';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type TransactionSource = 'manual' | 'ai' | 'import';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** e.g. cash, bank, credit_card, loan, investment */
  subtype?: string;
  /** ISO 4217 code, e.g. "USD" */
  currency: string;
  /**
   * Balance as a signed asset value, in minor units.
   * For a liability (e.g. credit card you owe on) this is typically negative.
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
}
