/** Shared helpers for building domain objects in step definitions. */
import { Account, Transaction } from '../../src/domain/types';
import { toMinorUnits } from '../../src/domain/money';

let counter = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++counter}`;

/** Parse a "12.34" money string into minor units. */
export const money = (s: string) => toMinorUnits(parseFloat(s));

/** Parse a "YYYY-MM-DD" date into a UTC epoch (ms). */
export function dateToEpoch(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

export function makeAccount(partial: Partial<Account> & Pick<Account, 'name'>): Account {
  return {
    id: partial.id ?? nextId('acc'),
    name: partial.name,
    tag: partial.tag ?? null,
    currency: partial.currency ?? 'USD',
    openingBalance: partial.openingBalance ?? 0,
    archived: partial.archived ?? false,
  };
}

export function makeTransaction(
  partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>
): Transaction {
  return {
    id: partial.id ?? nextId('tx'),
    accountId: partial.accountId,
    type: partial.type,
    amount: partial.amount,
    currency: partial.currency ?? 'USD',
    categoryId: partial.categoryId ?? null,
    payeeId: partial.payeeId ?? null,
    transferAccountId: partial.transferAccountId ?? null,
    note: partial.note ?? null,
    occurredAt: partial.occurredAt ?? Date.UTC(2026, 0, 1),
    createdAt: partial.createdAt ?? Date.UTC(2026, 0, 1),
    source: partial.source ?? 'manual',
    receiptRef: partial.receiptRef ?? null,
    pending: partial.pending ?? false,
  };
}
