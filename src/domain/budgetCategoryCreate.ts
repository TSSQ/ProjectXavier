/**
 * A set-budget for a category the user does not have (docs/design/monthly-
 * budgets-spec.md §6.5): resolve the typed words to an existing category, a
 * "did you mean" (with an offer to create the typed name instead), an offer to
 * create it, or a plain reply. Edit and remove never offer to create: they act
 * on something that should already be there. Pure; the write is
 * `createCategoryWithBudget` (src/features/budgets/createCategoryBudget.ts).
 */
import { Category } from './types';
import { categorySchema } from '../lib/validation';
import { MULTI_CATEGORY, resolveBudgetCategory, validCategoryWords } from './budgetIntent';
import type { EditBudgetIntent, RemoveBudgetIntent, SetBudgetIntent } from './budgetIntent';
import { noCategoryText, titleCase } from './budgetCopy';

const MAX_NAME_LENGTH = 40;

/** The typed words as a new category name: title-cased and checked against the
 *  category name rules (zod) plus the router's own (no placeholders, digits,
 *  more than three words). Null when they cannot be a category name. */
export function newCategoryName(typed: string): string | null {
  const words = validCategoryWords(typed);
  if (words === null || MULTI_CATEGORY.test(words)) return null;
  const name = titleCase(words.trim().replace(/\s+/g, ' '));
  if (name.length < 2 || name.length > MAX_NAME_LENGTH || !/[a-z]/i.test(name)) return null;
  return categorySchema.shape.name.safeParse(name).success ? name : null;
}

export type CategoryResolution =
  /** The category exists and the text names it: go on to the plan. */
  | { kind: 'proceed'; category: Category }
  /** "Did you mean X?"; `createName` adds the [Create "Typed"] button (set only). */
  | { kind: 'suggest'; category: Category; createName: string | null }
  /** "You don't have a Pets category yet. Create it with a $300 monthly budget?" */
  | { kind: 'offer-create'; name: string }
  | { kind: 'reply'; text: string };

export function resolveForCommand(
  intent: SetBudgetIntent | EditBudgetIntent | RemoveBudgetIntent,
  categories: Category[]
): CategoryResolution {
  const target = resolveBudgetCategory(intent.categoryName, categories);
  const isSet = intent.kind === 'set-budget';
  if (target.kind === 'exact') {
    // A model-picked category the text never names is checked with the user.
    return intent.ungrounded
      ? { kind: 'suggest', category: target.category, createName: null }
      : { kind: 'proceed', category: target.category };
  }
  if (target.kind === 'suggestion') {
    return {
      kind: 'suggest',
      category: target.category,
      createName: isSet ? newCategoryName(intent.categoryName) : null,
    };
  }
  if (!isSet) return { kind: 'reply', text: noCategoryText(titleCase(intent.categoryName)) };
  const name = newCategoryName(intent.categoryName);
  return name === null
    ? { kind: 'reply', text: `I couldn't find a ${titleCase(intent.categoryName)} category.` }
    : { kind: 'offer-create', name };
}

/** What confirming "Create & set budget" does: create the expense category
 *  (top-level, reusing one of that name if it appeared meanwhile) and write
 *  the budget onward, as one unit. */
export function createAndSetPlan(args: {
  name: string;
  amount: number;
  existing: Category[];
}): {
  create: { name: string; kind: 'expense'; parentId: null } | null;
  reuse: Category | null;
  write: { amount: number; scope: 'onward' };
} {
  const reuse =
    args.existing.find((c) => c.kind === 'expense' && c.name.toLowerCase() === args.name.toLowerCase()) ?? null;
  return {
    create: reuse ? null : { name: args.name, kind: 'expense', parentId: null },
    reuse,
    write: { amount: args.amount, scope: 'onward' },
  };
}
