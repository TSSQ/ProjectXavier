/**
 * Transaction data access. Inputs are validated with zod before insertion, and
 * persisted via parameterised statements.
 */
import { db } from '../../db/client';
import { transactions } from '../../db/schema';
import { Transaction } from '../../domain/types';
import { transactionSchema } from '../../lib/validation';

export async function listTransactions(): Promise<Transaction[]> {
  const rows = await db.select().from(transactions);
  return rows.map(rowToTransaction);
}

export async function createTransaction(input: Transaction): Promise<void> {
  // Validate shape/type at the trust boundary (throws on invalid input).
  const tx = transactionSchema.parse(input);
  await db.insert(transactions).values({
    id: tx.id,
    accountId: tx.accountId,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    categoryId: tx.categoryId ?? null,
    payeeId: tx.payeeId ?? null,
    transferAccountId: tx.transferAccountId ?? null,
    note: tx.note ?? null,
    occurredAt: tx.occurredAt,
    createdAt: tx.createdAt,
    source: tx.source,
    receiptRef: tx.receiptRef ?? null,
  });
}

function rowToTransaction(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type as Transaction['type'],
    amount: row.amount,
    currency: row.currency,
    categoryId: row.categoryId,
    payeeId: row.payeeId,
    transferAccountId: row.transferAccountId,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    source: row.source as Transaction['source'],
    receiptRef: row.receiptRef,
  };
}
