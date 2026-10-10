/**
 * Transaction data access. Inputs are validated with zod before insertion, and
 * persisted via parameterised statements.
 */
import { desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { transactions } from '../../db/schema';
import { Transaction } from '../../domain/types';
import { EntityUsage, GroundingUsage } from '../../domain/groundingSelection';
import { transactionSchema } from '../../lib/validation';
// Every save/edit/delete funnels through here, so this is where the widget
// hears about it — debounced, so a statement import's burst of saves costs
// one refresh. See src/features/widget/summary.ts's header.
import { scheduleWidgetSummaryUpdate } from '../widget/summary';
import { bumpDataRevision } from '../settings/repository';

export async function listTransactions(): Promise<Transaction[]> {
  const rows = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt));
  return rows.map(rowToTransaction);
}

/**
 * How often and how recently each payee and category appears on the ledger,
 * keyed by id - what the parse prompt needs to list the entities that matter
 * (src/domain/groundingSelection.ts) instead of every one the user has. Two
 * grouped aggregates, both built by Drizzle (parameterised, no values in the
 * SQL text); cheap enough to run per parse alongside `listPayees`.
 */
export async function listGroundingUsage(): Promise<GroundingUsage> {
  const [payeeRows, categoryRows] = await Promise.all([
    db
      .select({
        id: transactions.payeeId,
        count: sql<number>`count(*)`,
        lastUsedAt: sql<number>`max(${transactions.occurredAt})`,
      })
      .from(transactions)
      .where(isNotNull(transactions.payeeId))
      .groupBy(transactions.payeeId),
    db
      .select({
        id: transactions.categoryId,
        count: sql<number>`count(*)`,
        lastUsedAt: sql<number>`max(${transactions.occurredAt})`,
      })
      .from(transactions)
      .where(isNotNull(transactions.categoryId))
      .groupBy(transactions.categoryId),
  ]);
  const toUsage = (rows: Array<{ id: string | null; count: number; lastUsedAt: number | null }>) => {
    const out: Record<string, EntityUsage> = {};
    for (const r of rows) {
      if (r.id == null) continue;
      out[r.id] = { count: Number(r.count), lastUsedAt: r.lastUsedAt == null ? null : Number(r.lastUsedAt) };
    }
    return out;
  };
  return { payees: toUsage(payeeRows), categories: toUsage(categoryRows) };
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
    sourceText: tx.sourceText ?? null,
    seriesId: tx.seriesId ?? null,
    occurrenceDate: tx.occurrenceDate ?? null,
    pending: tx.pending,
  });
  await bumpDataRevision();
  // Debounced and fire-and-forget: widget staleness must never add latency
  // to a save, and the refresh swallows its own errors.
  scheduleWidgetSummaryUpdate();
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
      sourceText: tx.sourceText ?? null,
      seriesId: tx.seriesId ?? null,
      occurrenceDate: tx.occurrenceDate ?? null,
      pending: tx.pending,
    })
    .where(eq(transactions.id, tx.id));
  await bumpDataRevision();
  scheduleWidgetSummaryUpdate();
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, id));
  await bumpDataRevision();
  scheduleWidgetSummaryUpdate();
}

/**
 * Batch delete — the chat multi-select flow (docs/design/chat-transaction-
 * delete-update-spec.md §13 amendment). A loop of `deleteTransaction(id)`
 * calls cannot guarantee all-or-nothing: a failure partway through would
 * leave some rows deleted and others not. This issues ONE
 * `DELETE ... WHERE id IN (...)` statement instead — atomic by SQLite's own
 * single-statement semantics, no explicit `BEGIN`/`COMMIT` wrapper needed —
 * followed by a single `bumpDataRevision()`/widget refresh (never N of
 * either). Mirrors `deleteTransactionsForAccount` in
 * src/features/accounts/repository.ts's account-delete cascade, scoped by an
 * explicit id list instead of an account id. A no-op on an empty list.
 */
export async function deleteTransactions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(transactions).where(inArray(transactions.id, ids));
  await bumpDataRevision();
  scheduleWidgetSummaryUpdate();
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
    sourceText: row.sourceText,
    seriesId: row.seriesId ?? null,
    occurrenceDate: row.occurrenceDate ?? null,
    pending: row.pending ?? false,
  };
}
