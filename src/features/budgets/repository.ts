/**
 * Budget data access (docs/design/monthly-budgets-spec.md §3). Every statement
 * comes from src/db/budgetSql.ts — parameterised only — and every row is
 * validated with zod on the way in and on the way out. The write algorithm
 * itself (which rows to delete and insert) is the pure `planBudgetWrite`.
 */
import { expoDb } from '../../db/client';
import {
  SELECT_BUDGETS,
  RawBudgetRow,
  rawToBudgetRow,
  buildDeleteBudgetsForCategory,
  buildDeleteBudgetsFrom,
  buildInsertBudget,
} from '../../db/budgetSql';
import { BudgetRow, BudgetScope, BudgetWritePlan, MonthKey, planBudgetWrite } from '../../domain/budgets';
import { budgetRowSchema } from '../../lib/validation';
import { newId } from '../../lib/id';
import { bumpDataRevision } from '../settings/repository';
import { runExclusive } from '../../domain/backupGate';

export async function listBudgetRows(): Promise<BudgetRow[]> {
  const rows = await expoDb.getAllAsync<RawBudgetRow>(SELECT_BUDGETS.sql, SELECT_BUDGETS.params);
  return rows.map(rawToBudgetRow);
}

/**
 * Sets (or, with a null/zero amount, removes) a category's budget from `month`.
 * "month" writes a one-off; "onward" replaces this category's later settings
 * and carries forward until changed. The delete and the insert run in one
 * transaction so a failure never leaves the category with neither.
 */
export async function setBudget(args: {
  categoryId: string;
  /** Minor units; null or 0 removes the budget. */
  amount: number | null;
  month: MonthKey;
  scope: BudgetScope;
}): Promise<void> {
  const plan = planBudgetWrite({ ...args, id: newId(), now: Date.now() });
  budgetRowSchema.parse(plan.insert);
  // Inside the backup gate (H1): expo-sqlite's shared connection is not safe
  // against a backup snapshot interleaving with this transaction.
  await runExclusive(() =>
    expoDb.withTransactionAsync(() => applyBudgetPlan(args.categoryId, plan))
  );
  await bumpDataRevision();
}

/** The statements of one planned budget write. NOT exclusive and not its own
 *  transaction: the caller wraps it (setBudget, or the create-category write
 *  that makes the category in the same transaction). */
export async function applyBudgetPlan(categoryId: string, plan: BudgetWritePlan): Promise<void> {
  if (plan.deleteFromMonth !== null) {
    const del = buildDeleteBudgetsFrom(categoryId, plan.deleteFromMonth);
    await expoDb.runAsync(del.sql, del.params);
  }
  const ins = buildInsertBudget(plan.insert);
  await expoDb.runAsync(ins.sql, ins.params);
}

/** Writes several "onward" budgets at once (first-run "Use these budgets"). */
export async function setBudgetsOnward(
  entries: Array<{ categoryId: string; amount: number }>,
  month: MonthKey
): Promise<void> {
  const now = Date.now();
  await runExclusive(() => expoDb.withTransactionAsync(async () => {
    for (const e of entries) {
      const plan = planBudgetWrite({
        id: newId(),
        categoryId: e.categoryId,
        amount: e.amount,
        month,
        scope: 'onward',
        now,
      });
      budgetRowSchema.parse(plan.insert);
      const del = buildDeleteBudgetsFrom(e.categoryId, month);
      await expoDb.runAsync(del.sql, del.params);
      const ins = buildInsertBudget(plan.insert);
      await expoDb.runAsync(ins.sql, ins.params);
    }
  }));
  await bumpDataRevision();
}

/** Removes every budget row of a category. NOT exclusive on its own: it runs
 *  inside the category delete's transaction, which holds the backup gate
 *  (the gate is not re-entrant, so this must never take it again). */
export async function deleteBudgetsForCategory(categoryId: string): Promise<void> {
  const del = buildDeleteBudgetsForCategory(categoryId);
  await expoDb.runAsync(del.sql, del.params);
}
