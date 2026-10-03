/**
 * Guards for an Assistant budget card that has sat on screen while the data
 * moved underneath it (the same discipline as the stale txOp picker and the
 * stale draft card). Pure, so the rules are tested in Node.
 */
import { Category } from './types';
import { budgetableCategories } from './budgets';

/** A card built against data revision `replyRevision` is stale once any write
 *  has moved the revision on. */
export function isStaleBudgetReply(replyRevision: number, currentRevision: number): boolean {
  return replyRevision !== currentRevision;
}

export type SetBudgetCheck = 'ok' | 'category-gone' | 'currency-changed';

/**
 * Whether a set-budget confirm may still be written: the category must still
 * exist as a top-level expense category, and the currency must be the one the
 * amount was converted to minor units in (a relabel in between would make the
 * stored number mean something else).
 */
export function checkSetBudgetConfirm(args: {
  categoryId: string;
  currency: string;
  currentCurrency: string;
  categories: Category[];
}): SetBudgetCheck {
  if (!budgetableCategories(args.categories).some((c) => c.id === args.categoryId)) {
    return 'category-gone';
  }
  return args.currency === args.currentCurrency ? 'ok' : 'currency-changed';
}

export function setBudgetRefusalText(check: Exclude<SetBudgetCheck, 'ok'>): string {
  return check === 'category-gone'
    ? "That category isn't there any more — tell me again?"
    : 'The currency changed since I asked — tell me the amount again?';
}
