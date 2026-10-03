/**
 * The afford answer, decided (docs/design/monthly-budgets-spec.md §6.2): which
 * budget the purchase would come from, whether it fits, and the deterministic
 * reply. Pure — the Assistant screen only renders the plan.
 *
 * Category inference is the app's existing deterministic one for a spend, with
 * nothing saved: the heuristic parse of the subject (an exact existing
 * category name), then the named payee's default category. Only a top-level,
 * budgeted category is used; anything else asks "Which budget would this come
 * from?" with chips instead of guessing.
 */
import { Category, Payee } from './types';
import { AffordIntent, affordNoun } from './budgetIntent';
import { heuristicExpense } from './heuristicParse';
import { findCategoryMatch } from './categories';
import { findPayeeMatch } from './payees';
import { toMinorUnits } from './money';
import {
  AffordResult,
  BudgetSummary,
  CategoryBudget,
  MonthKey,
  affordAnswer,
  topLevelCategoryId,
} from './budgets';
import { affordReply, overallLine } from './budgetCopy';

export const AFFORD_PICK_TEXT = 'Which budget would this come from?';
export const NO_BUDGETS_TEXT = "You haven't set any budgets yet.";
/** The most category chips offered before "All budgets". */
export const AFFORD_PICK_MAX = 6;

export interface AffordContext {
  categories: Category[];
  payees: Payee[];
  summary: BudgetSummary;
  now: number;
  currency: string;
}

/** The budgeted top-level category a spend described by `subject` would be
 *  filed under, or null when inference does not land on one. */
export function inferAffordCategory(subject: string, ctx: AffordContext): string | null {
  const parsed = heuristicExpense(subject, {
    categories: ctx.categories,
    payees: ctx.payees,
    now: ctx.now,
    currency: ctx.currency,
  });
  if (!parsed) return null;
  let categoryId: string | null = null;
  if (parsed.category) {
    categoryId = findCategoryMatch(parsed.category, 'expense', ctx.categories).exact?.id ?? null;
  }
  if (!categoryId && parsed.payee) {
    categoryId = findPayeeMatch(parsed.payee, ctx.payees).exact?.defaultCategoryId ?? null;
  }
  if (!categoryId) return null;
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const top = topLevelCategoryId(categoryId, byId);
  return top && ctx.summary.categories.some((v) => v.categoryId === top) ? top : null;
}

export interface PickOption {
  categoryId: string;
  name: string;
  icon: string | null;
}

export type AffordPlan =
  | { kind: 'no-budgets'; text: string }
  | { kind: 'pick'; text: string; options: PickOption[] }
  | {
      kind: 'answer';
      text: string;
      /** A category id, or 'all'. */
      scope: string;
      /** Null for "all budgets". */
      categoryName: string | null;
      icon: string | null;
      result: AffordResult;
      /** The category's budget view; null for "all budgets". */
      view: CategoryBudget | null;
      /** Purchase amount, minor units. */
      amount: number;
      month: MonthKey;
      /** "All budgets together would still have $363 left." (over only). */
      overall: string | null;
    };

/**
 * Plans the answer. `scope` is the user's chip choice (a category id or
 * 'all'); without it the category is inferred, falling back to the chips.
 */
export function planAfford(
  intent: AffordIntent,
  ctx: AffordContext,
  scope?: string
): AffordPlan {
  const { summary, categories, currency } = ctx;
  if (summary.categories.length === 0) return { kind: 'no-budgets', text: NO_BUDGETS_TEXT };

  const chosen = scope ?? inferAffordCategory(intent.subject, ctx);
  if (!chosen) {
    const options = summary.categories.slice(0, AFFORD_PICK_MAX).map((v) => {
      const cat = categories.find((c) => c.id === v.categoryId);
      return { categoryId: v.categoryId, name: cat?.name ?? 'Category', icon: cat?.icon ?? null };
    });
    return { kind: 'pick', text: AFFORD_PICK_TEXT, options };
  }

  const amount = toMinorUnits(intent.amount, currency);
  const result = affordAnswer(
    amount,
    chosen === 'all' ? { kind: 'all' } : { kind: 'category', categoryId: chosen },
    summary
  );
  // A stale chip pointing at a budget that has since been removed: other
  // budgets exist, so ask again (without the scope) rather than claim there
  // are none.
  if (!result) return scope !== undefined ? planAfford(intent, ctx) : { kind: 'no-budgets', text: NO_BUDGETS_TEXT };
  const view = chosen === 'all' ? null : (summary.categories.find((v) => v.categoryId === chosen) ?? null);
  const cat = categories.find((c) => c.id === chosen);
  const categoryName = chosen === 'all' ? null : (cat?.name ?? 'Category');
  return {
    kind: 'answer',
    text: affordReply({
      result,
      categoryName,
      amount,
      noun: affordNoun(intent.subject),
      daysLeft: summary.daysLeft,
      currency,
    }),
    scope: chosen,
    categoryName,
    icon: chosen === 'all' ? null : (cat?.icon ?? '🏷️'),
    result,
    view,
    amount,
    month: summary.month,
    overall: overallLine(result, currency),
  };
}

/**
 * The category name an afford "Log it" draft should carry. The budget's own
 * category is preset, except when the parse already found a category whose
 * top-level ancestor IS that budget — a more specific subcategory ("Takeout"
 * under Dining) is kept. Returns null to leave the draft's category alone.
 */
export function presetCategoryName(
  draftCategoryName: string | null,
  preset: { id: string; name: string },
  categories: Category[]
): string | null {
  if (draftCategoryName) {
    const parsed = findCategoryMatch(draftCategoryName, 'expense', categories).exact;
    const byId = new Map(categories.map((c) => [c.id, c]));
    if (parsed && topLevelCategoryId(parsed.id, byId) === preset.id) return null;
  }
  return preset.name;
}
