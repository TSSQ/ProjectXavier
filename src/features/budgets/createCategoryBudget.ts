/**
 * "Create & set budget" (docs/design/monthly-budgets-spec.md §6.5): makes the
 * expense category and writes its budget onward in ONE transaction, under the
 * backup gate, so a failure never leaves a category without the budget the user
 * confirmed, and a backup snapshot never sees one without the other.
 *
 * `findOrCreateByName` (parameterised Drizzle, case-insensitive) is reused, so a
 * category of that name that appeared meanwhile is used rather than duplicated.
 * Both rows are ordinary data in the whole-DB backup image.
 */
import { expoDb } from '../../db/client';
import { MonthKey, planBudgetWrite } from '../../domain/budgets';
import { budgetRowSchema, categorySchema } from '../../lib/validation';
import { newId } from '../../lib/id';
import { runExclusive } from '../../domain/backupGate';
import { findOrCreateByName } from '../categories/repository';
import { bumpDataRevision } from '../settings/repository';
import { applyBudgetPlan } from './repository';

/** Returns the id of the (new or existing) category. */
export async function createCategoryWithBudget(args: {
  name: string;
  /** Minor units, above zero. */
  amount: number;
  month: MonthKey;
}): Promise<string> {
  const name = categorySchema.shape.name.parse(args.name);
  if (args.amount <= 0) throw new Error('A budget needs an amount above zero.');
  let categoryId = '';
  await runExclusive(() =>
    expoDb.withTransactionAsync(async () => {
      categoryId = await findOrCreateByName(name, 'expense');
      const plan = planBudgetWrite({
        id: newId(),
        categoryId,
        amount: args.amount,
        month: args.month,
        scope: 'onward',
        now: Date.now(),
      });
      budgetRowSchema.parse(plan.insert);
      await applyBudgetPlan(categoryId, plan);
    })
  );
  await bumpDataRevision();
  return categoryId;
}
