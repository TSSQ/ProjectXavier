/**
 * Pure "copy transaction" semantics, shared by every screen that offers a
 * long-press "Copy" action on a transaction row (the account details screen
 * and the Transactions tab). Framework-free — no React/Expo/component
 * imports — so it's Node-testable in tests/.
 *
 * A copy is a fresh, standalone entry:
 *  - dated `now`, not the original's occurredAt — a copy is logged today;
 *  - accountId comes from the transaction itself, never from a "current
 *    screen" account — the Transactions tab spans multiple accounts, so this
 *    matters there in a way it didn't when only the (single-account) account
 *    screen had this feature;
 *  - never part of a recurring series — repeatRule/seriesId/occurrenceDate
 *    are all cleared, even if the original was a posted series occurrence;
 *  - never pending — a fresh entry starts counted regardless of whether the
 *    original was pending.
 */
import { RecurrenceRule, Transaction } from './types';

/**
 * The subset of TransactionFormSheet's `FormValues` this helper produces.
 * Duplicated here (not imported) to keep domain/ free of component imports;
 * the shape must stay in sync with `FormValues` in
 * src/components/transactions/TransactionFormSheet.tsx.
 */
export interface CopyInitial {
  accountId: string;
  transferAccountId: string;
  type: Transaction['type'];
  amountMinor: number;
  date: number;
  categoryName: string;
  payeeName: string;
  note: string;
  repeatRule: RecurrenceRule | null;
  seriesId: string | null;
  occurrenceDate: number | null;
  pending: boolean;
}

export interface CopyNames {
  payeeName: string;
  categoryName: string;
}

/** Build the pre-filled form values for duplicating `tx` as a new entry. */
export function buildCopyInitial(
  tx: Transaction,
  { payeeName, categoryName, now }: CopyNames & { now: number }
): CopyInitial {
  return {
    accountId: tx.accountId,
    transferAccountId: tx.transferAccountId ?? '',
    type: tx.type,
    amountMinor: tx.amount, // already minor units
    date: now,
    categoryName,
    payeeName,
    note: tx.note ?? '',
    repeatRule: null,
    seriesId: null,
    occurrenceDate: null,
    pending: false,
  };
}

/**
 * Copy-mode banner label: payee name, else category name, else the
 * sentence-cased transaction type ("Expense" / "Income" / "Transfer").
 */
export function copyLabelFor(tx: Transaction, { payeeName, categoryName }: CopyNames): string {
  return payeeName || categoryName || sentenceCase(tx.type);
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
