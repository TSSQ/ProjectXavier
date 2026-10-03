/**
 * The orchestration of "Create & set budget" (docs/design/monthly-budgets-spec.md
 * §6.5), free of the database so the plain-Node suite runs the REAL path with
 * in-memory deps. `src/features/budgets/createCategoryBudget.ts` supplies the
 * database deps and wraps this in the backup gate and one transaction.
 *
 * The plan looks at ALL categories, sub-categories included, so a name that
 * belongs to `Home > Pets` is refused rather than reused: a budget on a
 * non-top-level category would break the top-level-only invariant.
 */
import { Category } from './types';
import { MonthKey } from './budgets';
import { categorySchema } from '../lib/validation';
import { createAndSetPlan } from './budgetCategoryCreate';

/** The name cannot take a new budget category (it is a sub- or income category). */
export class CreateCategoryRefused extends Error {}

export interface CreateCategoryBudgetDeps {
  listCategories: () => Promise<Category[]>;
  /** Creates a top-level expense category, returning its id. */
  createExpenseCategory: (name: string) => Promise<string>;
  /** Writes the budget onward (minor units). */
  writeBudget: (categoryId: string, amount: number, month: MonthKey) => Promise<void>;
}

/** Returns the id of the (new or reused) category; throws `CreateCategoryRefused`. */
export async function createCategoryWithBudgetFlow(
  args: { name: string; amount: number; month: MonthKey },
  deps: CreateCategoryBudgetDeps
): Promise<string> {
  const name = categorySchema.shape.name.parse(args.name);
  if (!(args.amount > 0)) throw new Error('A budget needs an amount above zero.');
  const plan = createAndSetPlan({ name, amount: args.amount, existing: await deps.listCategories() });
  if (plan.kind === 'refuse') throw new CreateCategoryRefused(plan.text);
  const categoryId =
    plan.kind === 'reuse' ? plan.category.id : await deps.createExpenseCategory(plan.name);
  await deps.writeBudget(categoryId, plan.write.amount, args.month);
  return categoryId;
}
