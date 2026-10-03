/**
 * "Create & set budget" (docs/design/monthly-budgets-spec.md §6.5): makes the
 * expense category and writes its budget onward in ONE transaction, under the
 * backup gate, so a failure never leaves a category without the budget the user
 * confirmed, and a backup snapshot never sees one without the other. The
 * decisions live in `createCategoryWithBudgetFlow` (src/domain), which the
 * plain-Node suite runs with in-memory deps; this file only supplies the
 * database ones.
 *
 * `findOrCreateByName` (parameterised Drizzle, case-insensitive) creates the
 * category; the flow has already checked every category, sub-categories
 * included, so it can only ever create. Both rows are ordinary data in the
 * whole-DB backup image.
 */
import { expoDb } from '../../db/client';
import { MonthKey, planBudgetWrite } from '../../domain/budgets';
import { budgetRowSchema } from '../../lib/validation';
import { newId } from '../../lib/id';
import { runExclusive } from '../../domain/backupGate';
import { createCategoryWithBudgetFlow } from '../../domain/createCategoryBudgetFlow';
import { findOrCreateByName, listCategories } from '../categories/repository';
import { bumpDataRevision } from '../settings/repository';
import { applyBudgetPlan } from './repository';

export { CreateCategoryRefused } from '../../domain/createCategoryBudgetFlow';

/** Returns the id of the (new or existing) category. */
export async function createCategoryWithBudget(args: {
  name: string;
  /** Minor units, above zero. */
  amount: number;
  month: MonthKey;
}): Promise<string> {
  let categoryId = '';
  await runExclusive(() =>
    expoDb.withTransactionAsync(async () => {
      categoryId = await createCategoryWithBudgetFlow(args, {
        listCategories,
        createExpenseCategory: (name) => findOrCreateByName(name, 'expense'),
        writeBudget: async (id, amount, month) => {
          const plan = planBudgetWrite({
            id: newId(),
            categoryId: id,
            amount,
            month,
            scope: 'onward',
            now: Date.now(),
          });
          budgetRowSchema.parse(plan.insert);
          await applyBudgetPlan(id, plan);
        },
      });
    })
  );
  await bumpDataRevision();
  return categoryId;
}
