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
import { childCategoryText, incomeCategoryText, noCategoryText, titleCase } from './budgetCopy';
import { topLevelCategoryId } from './budgets';
import { normalizeName } from './textMatch';

const MAX_NAME_LENGTH = 40;

/** Words that are not a name for a new category. Only CREATION is blocked: an
 *  existing category called "Other" still matches. */
const PLACEHOLDER_NAMES = new Set(['none', 'misc', 'miscellaneous', 'other', 'stuff', 'things', 'thing']);

/** A category that already uses the name but cannot take a budget: a
 *  sub-category (the budget lives on its top-level parent) or an income one. */
export type CategoryConflict =
  | { kind: 'child'; child: Category; top: Category }
  | { kind: 'income'; category: Category };

export function categoryConflict(name: string, categories: Category[]): CategoryConflict | null {
  const target = normalizeName(name);
  const byId = new Map(categories.map((c) => [c.id, c]));
  for (const c of categories) {
    if (normalizeName(c.name) !== target) continue;
    if (c.kind === 'income') return { kind: 'income', category: c };
    if (c.kind !== 'expense' || !c.parentId || !byId.has(c.parentId)) continue;
    const top = byId.get(topLevelCategoryId(c.id, byId) ?? '');
    if (top && top.id !== c.id) return { kind: 'child', child: c, top };
  }
  return null;
}

export function conflictText(conflict: CategoryConflict): string {
  return conflict.kind === 'child'
    ? childCategoryText(conflict.child.name, conflict.top.name)
    : incomeCategoryText(conflict.category.name);
}

/** The typed words as a new category name: title-cased and checked against the
 *  category name rules (zod) plus the router's own (no placeholders, digits,
 *  more than three words). Null when they cannot be a category name. */
export function newCategoryName(typed: string): string | null {
  const words = validCategoryWords(typed);
  if (words === null || MULTI_CATEGORY.test(words)) return null;
  const name = titleCase(words.trim().replace(/\s+/g, ' '));
  if (name.length < 2 || name.length > MAX_NAME_LENGTH || !/[a-z]/i.test(name)) return null;
  if (name.toLowerCase().split(' ').every((w) => PLACEHOLDER_NAMES.has(w))) return null;
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
  // A sub-category or an income category of that name is not "missing": say
  // what it is instead of offering to create a duplicate.
  const conflict = target.kind === 'exact' ? null : categoryConflict(intent.categoryName, categories);
  if (conflict) return { kind: 'reply', text: conflictText(conflict) };
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

/** What confirming "Create & set budget" does, decided from ALL the user's
 *  categories: create the expense category (top-level), reuse a top-level
 *  expense one that appeared meanwhile, or refuse when the name belongs to a
 *  sub-category or an income category. The budget is written onward either way. */
export type CreateAndSetPlan =
  | { kind: 'create'; name: string; write: { amount: number; scope: 'onward' } }
  | { kind: 'reuse'; category: Category; write: { amount: number; scope: 'onward' } }
  | { kind: 'refuse'; text: string };

export function createAndSetPlan(args: { name: string; amount: number; existing: Category[] }): CreateAndSetPlan {
  const write = { amount: args.amount, scope: 'onward' as const };
  const conflict = categoryConflict(args.name, args.existing);
  if (conflict) return { kind: 'refuse', text: conflictText(conflict) };
  const reuse = args.existing.find(
    (c) => c.kind === 'expense' && normalizeName(c.name) === normalizeName(args.name)
  );
  return reuse ? { kind: 'reuse', category: reuse, write } : { kind: 'create', name: args.name, write };
}
