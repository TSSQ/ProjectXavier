/**
 * Transaction data access. Inputs are validated with zod before insertion, and
 * persisted via parameterised statements.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { transactions } from '../../db/schema';
import { Transaction } from '../../domain/types';
import { transactionSchema } from '../../lib/validation';

export async function listTransactions(): Promise<Transaction[]> {
  // Newest activity appears first in the ledger and dashboard summaries.
  const rows = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt));
  return rows.map(rowToTransaction);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  return rows[0] ? rowToTransaction(rows[0]) : null;
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

export async function updateTransaction(input: Transaction): Promise<void> {
  const tx = transactionSchema.parse(input);
  await db
    .update(transactions)
    .set({
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
    })
    .where(eq(transactions.id, tx.id));
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, id));
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
