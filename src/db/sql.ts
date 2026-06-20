/**
 * Parameterised SQL builders.
 *
 * Every value is passed as a bound parameter (`?`), never concatenated into the
 * SQL string. This is the structural guarantee that user/AI free-text (e.g. a
 * note containing `'; DROP TABLE ...`) can never alter a query. The returned
 * `{ sql, params }` is fed verbatim to expo-sqlite's `runAsync(sql, params)` in
 * the app, and is asserted in the BDD input-safety suite.
 */
import { Transaction } from '../domain/types';

export interface ParameterisedStatement {
  sql: string;
  params: Array<string | number | null>;
}

/** Any executor that runs a parameterised statement (e.g. expo-sqlite). */
export interface SqlExecutor {
  run(sql: string, params: Array<string | number | null>): Promise<void>;
}

export function buildInsertTransaction(tx: Transaction): ParameterisedStatement {
  return {
    sql: `INSERT INTO transactions
      (id, account_id, type, amount, currency, category_id, payee_id,
       transfer_account_id, note, occurred_at, created_at, source, receipt_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      tx.id,
      tx.accountId,
      tx.type,
      tx.amount,
      tx.currency,
      tx.categoryId ?? null,
      tx.payeeId ?? null,
      tx.transferAccountId ?? null,
      tx.note ?? null,
      tx.occurredAt,
      tx.createdAt,
      tx.source,
      tx.receiptRef ?? null,
    ],
  };
}

/** Insert a transaction through an executor using bound parameters only. */
export async function insertTransaction(
  executor: SqlExecutor,
  tx: Transaction
): Promise<void> {
  const { sql, params } = buildInsertTransaction(tx);
  await executor.run(sql, params);
}
