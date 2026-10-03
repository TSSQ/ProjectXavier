/**
 * Parameterised SQL for the `budgets` table (docs/design/monthly-budgets-spec.md
 * §3), built as `{ sql, params }` like src/db/sql.ts: every value is a bound
 * `?`, never concatenated, and the plain-Node suite asserts exactly that. The
 * repository (src/features/budgets/repository.ts) feeds these to expo-sqlite;
 * the tests feed the same text to node:sqlite, so the SQL that ships is the
 * SQL that is tested.
 *
 * Imports only pure modules — no driver — so it is loadable in Node.
 */
import type { BudgetRow, MonthKey } from '../domain/budgets';
import type { ParameterisedStatement } from './sql';
import { budgetRowSchema } from '../lib/validation';

export const SELECT_BUDGETS: ParameterisedStatement = {
  sql: `SELECT id, category_id, amount, start_month, end_month, created_at
        FROM budgets ORDER BY start_month, created_at`,
  params: [],
};

export function buildInsertBudget(row: BudgetRow): ParameterisedStatement {
  return {
    sql: `INSERT INTO budgets (id, category_id, amount, start_month, end_month, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [row.id, row.categoryId, row.amount, row.startMonth, row.endMonth, row.createdAt],
  };
}

/** Delete a category's rows starting at or after `month`. 'YYYY-MM' strings
 *  compare chronologically, so plain `>=` is correct. */
export function buildDeleteBudgetsFrom(categoryId: string, month: MonthKey): ParameterisedStatement {
  return {
    sql: `DELETE FROM budgets WHERE category_id = ? AND start_month >= ?`,
    params: [categoryId, month],
  };
}

export function buildDeleteBudgetsForCategory(categoryId: string): ParameterisedStatement {
  return { sql: `DELETE FROM budgets WHERE category_id = ?`, params: [categoryId] };
}

/** The raw column shape `SELECT_BUDGETS` returns. */
export interface RawBudgetRow {
  id: unknown;
  category_id: unknown;
  amount: unknown;
  start_month: unknown;
  end_month: unknown;
  created_at: unknown;
}

/** A raw row, validated with zod (the table is a trust boundary: backups are
 *  user-editable files that restore into it). */
export function rawToBudgetRow(raw: RawBudgetRow): BudgetRow {
  return budgetRowSchema.parse({
    id: raw.id,
    categoryId: raw.category_id,
    amount: raw.amount,
    startMonth: raw.start_month,
    endMonth: raw.end_month,
    createdAt: raw.created_at,
  }) as BudgetRow;
}
