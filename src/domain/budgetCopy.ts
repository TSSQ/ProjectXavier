/**
 * Deterministic budget copy (docs/design/monthly-budgets-spec.md §6). Every
 * number in an Assistant reply comes from a template here — no model prose
 * ever states a figure. Framework-free.
 */
import { formatMoney, toMajorUnits } from './money';
import { currencyExponent } from './currency';
import {
  AffordResult,
  BudgetSummary,
  CategoryBudget,
  MonthKey,
  monthLabel,
  monthName,
} from './budgets';
import type { BudgetClarifyReason } from './budgetIntent';

const wholeFormatters = new Map<string, Intl.NumberFormat>();

/** A whole-unit currency formatter, built once per locale|currency (building
 *  an Intl.NumberFormat costs far more than using one). Throws for a
 *  malformed currency code, like the constructor. */
function wholeFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let f = wholeFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    wholeFormatters.set(key, f);
  }
  return f;
}

/** "$600", "$2,100", "$175.50" — whole amounts drop the zero decimals, the way
 *  the mockup writes them; anything with a fraction keeps it. */
export function formatBudgetMoney(minor: number, currency = 'USD', locale = 'en-US'): string {
  const unit = 10 ** currencyExponent(currency);
  if (Math.abs(minor) % unit !== 0) return formatMoney(minor, currency, locale);
  try {
    return wholeFormatter(locale, currency).format(toMajorUnits(minor, currency));
  } catch {
    return formatMoney(minor, currency, locale);
  }
}

/** A whole-unit figure, rounded: "$51" for $50.77 — for the per-day pace, which
 *  is an estimate ("about $51/day"), not a ledger amount. */
export function formatBudgetWhole(minor: number, currency = 'USD', locale = 'en-US'): string {
  try {
    return wholeFormatter(locale, currency).format(toMajorUnits(minor, currency));
  } catch {
    return formatMoney(minor, currency, locale);
  }
}

/** "$21 over" / "$188 left" — the state in words as well as colour. */
export function leftOrOver(left: number, currency: string): string {
  return left < 0
    ? `${formatBudgetMoney(-left, currency)} over`
    : `${formatBudgetMoney(left, currency)} left`;
}

/** "13 days left · about $51/day", "Last day", or null when nothing applies. */
export function paceLine(summary: BudgetSummary, currency: string): string | null {
  if (summary.daysLeft === null) return null;
  if (summary.lastDay) return 'Last day';
  const days = `${summary.daysLeft} day${summary.daysLeft === 1 ? '' : 's'} left`;
  return summary.perDay === null
    ? days
    : `${days} · about ${formatBudgetWhole(summary.perDay, currency)}/day`;
}

/** The legend under a bar: "Spent $1,287 · Scheduled $150" (scheduled only when > 0). */
export function legendText(
  spent: number,
  scheduled: number,
  currency: string,
  spentLabel = 'Spent'
): { spent: string; scheduled: string | null } {
  return {
    spent: `${spentLabel} ${formatBudgetMoney(spent, currency)}`,
    scheduled: scheduled > 0 ? `Scheduled ${formatBudgetMoney(scheduled, currency)}` : null,
  };
}

/** The Budget screen row's second line. */
export function categoryDetailLine(v: CategoryBudget, currency: string): string {
  const budget = formatBudgetMoney(v.budget, currency);
  return v.scheduled > 0
    ? `${formatBudgetMoney(v.spent, currency)} paid · ${formatBudgetMoney(v.scheduled, currency)} scheduled · of ${budget}`
    : `${formatBudgetMoney(v.spent, currency)} of ${budget}`;
}

/** "+ 4 more on track" / "+ 2 more". */
export function moreLine(count: number, allOk: boolean): string {
  return `+ ${count} more${allOk ? ' on track' : ''}`;
}

// ─── afford ─────────────────────────────────────────────────────────────────

export interface AffordReplyInput {
  result: AffordResult;
  /** The category's name, or null for "all budgets". */
  categoryName: string | null;
  /** Purchase amount, minor units. */
  amount: number;
  /** The thing bought ("phone"), or "". */
  noun: string;
  daysLeft: number | null;
  currency: string;
}

/** The deterministic afford reply (spec §6.2 step 3). */
export function affordReply(input: AffordReplyInput): string {
  const { result, categoryName, amount, noun, daysLeft, currency } = input;
  const money = (n: number) => formatBudgetMoney(n, currency);
  if (categoryName === null) {
    return result.verdict === 'fits'
      ? `Yes. All budgets together would still have ${money(result.after)} left.`
      : `Not this month. All budgets together have ${money(result.leftNow)} left.`;
  }
  if (result.verdict === 'fits') {
    if (daysLeft !== null && daysLeft > 0) {
      const perDay = Math.round(result.after / daysLeft);
      return `Yes. ${categoryName} would still have ${money(result.after)} for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}, about ${formatBudgetWhole(perDay, currency)} a day.`;
    }
    return `Yes. ${categoryName} would still have ${money(result.after)} this month.`;
  }
  const what = noun ? `a ${money(amount)} ${noun}` : 'this';
  return `Not from ${categoryName}. It has ${money(Math.max(0, result.leftNow))} left, so ${what} would put it ${money(-result.after)} over.`;
}

/** The "All budgets together …" line under an over card; null unless > 0. */
export function overallLine(result: AffordResult, currency: string): string | null {
  return result.verdict === 'over' && result.overallLeftAfter > 0
    ? `All budgets together would still have ${formatBudgetMoney(result.overallLeftAfter, currency)} left.`
    : null;
}

// ─── set budget ─────────────────────────────────────────────────────────────

/** "Change Groceries from $400 to $450, starting October?" or the first-time form. */
export function setBudgetConfirmText(args: {
  categoryName: string;
  current: number | null;
  next: number;
  month: MonthKey;
  currency: string;
}): string {
  const { categoryName, current, next, month, currency } = args;
  const to = formatBudgetMoney(next, currency);
  return current === null
    ? `Set a ${categoryName} budget of ${to}, starting ${monthName(month)}?`
    : `Change ${categoryName} from ${formatBudgetMoney(current, currency)} to ${to}, starting ${monthName(month)}?`;
}

/** Editing a budget that is not there: offer to set it instead. */
export function editMissingBudgetText(args: {
  categoryName: string;
  next: number;
  month: MonthKey;
  currency: string;
}): string {
  return `You don't have a ${args.categoryName} budget yet. Set it to ${formatBudgetMoney(args.next, args.currency)}, starting ${monthName(args.month)}?`;
}

/** "Raise Food's ongoing budget by $50, from $300 to $350, starting October?"
 *  Built on the ongoing amount, and says so when this month has a one-off. */
export function editDeltaConfirmText(args: {
  categoryName: string;
  direction: 'raise' | 'lower';
  delta: number;
  current: number;
  next: number;
  month: MonthKey;
  currency: string;
  /** This month's one-off amount, when it differs from the ongoing one. */
  oneOff?: number;
}): string {
  const { categoryName, direction, delta, current, next, month, currency, oneOff } = args;
  const verb = direction === 'raise' ? 'Raise' : 'Lower';
  const replaced =
    oneOff === undefined
      ? ''
      : ` (${monthName(month)}'s one-off ${formatBudgetMoney(oneOff, currency)} is replaced)`;
  return `${verb} ${categoryName}'s ongoing budget by ${formatBudgetMoney(delta, currency)}, from ${formatBudgetMoney(current, currency)} to ${formatBudgetMoney(next, currency)}${replaced}, starting ${monthName(month)}?`;
}

/** A delta edit when only a one-off covers this month. */
export function oneOffOnlyText(args: {
  categoryName: string;
  oneOff: number;
  month: MonthKey;
  currency: string;
}): string {
  const { categoryName, oneOff, month, currency } = args;
  return `${categoryName} has only a one-off ${formatBudgetMoney(oneOff, currency)} for ${monthName(month)}, no ongoing budget. Try: set ${categoryName.toLowerCase()} budget to 300`;
}

/** "Remove Food budget ($300/month)?" */
export function removeBudgetConfirmText(args: {
  categoryName: string;
  current: number;
  currency: string;
}): string {
  return `Remove ${args.categoryName} budget (${formatBudgetMoney(args.current, args.currency)}/month)?`;
}

/** "You don't have a Food budget." */
export function noBudgetText(categoryName: string): string {
  return `You don't have a ${categoryName} budget.`;
}

/** "Food is already $300 a month." */
export function alreadyBudgetText(args: { categoryName: string; amount: number; currency: string }): string {
  return `${args.categoryName} is already ${formatBudgetMoney(args.amount, args.currency)} a month.`;
}

/** A lowering that would reach zero or below: point at Remove instead. */
export function belowZeroText(args: {
  categoryName: string;
  delta: number;
  current: number;
  currency: string;
}): string {
  const { categoryName, delta, current, currency } = args;
  return `Lowering ${categoryName} by ${formatBudgetMoney(delta, currency)} would leave nothing (it is ${formatBudgetMoney(current, currency)}). To remove it, say "remove ${categoryName.toLowerCase()} budget".`;
}

/** Editing by a delta with no budget to change. */
export function deltaMissingBudgetText(categoryName: string): string {
  return `You don't have a ${categoryName} budget yet. Try: set ${categoryName.toLowerCase()} budget to 300`;
}

/** The question for a budget command with a slot missing, or the hint for
 *  wording nobody could read. `example` is one of the user's own categories. */
export function budgetClarifyText(args: {
  missing: BudgetClarifyReason;
  categoryName?: string;
  example: string;
}): string {
  const ex = args.example.toLowerCase();
  const tryIt = `Try: set ${ex} budget to 300`;
  switch (args.missing) {
    case 'category':
      return `Which category? ${tryIt}`;
    case 'amount': {
      const name = args.categoryName ? `${args.categoryName} ` : '';
      return `How much should the ${name}budget be? Try: set ${(args.categoryName ?? ex).toLowerCase()} budget to 300`;
    }
    case 'all-budgets':
      return 'One category at a time — open Budget to clear several.';
    case 'total-budget':
      return 'Budgets are per category for now.';
    case 'single-category':
      return `One category at a time, please. ${tryIt}`;
    case 'monthly-only':
      return `Budgets are monthly, so I can't set a weekly or daily one. ${tryIt}`;
    case 'month-scope':
      return 'Budgets set here apply from this month onward. For a single month, use the Budget screen.';
    case 'positive-amount':
      return `A budget has to be more than zero. ${tryIt}`;
    case 'wording':
      return `I didn't catch that budget. ${tryIt}`;
  }
}

/** The offer to create a category a set-budget names. */
export function createCategoryOfferText(args: { name: string; amount: number; currency: string }): string {
  return `You don't have a ${args.name} category yet. Create it with a ${formatBudgetMoney(args.amount, args.currency)} monthly budget?`;
}

/** The name is a sub-category: budgets live on the top-level one. */
export function childCategoryText(child: string, parent: string): string {
  return `${child} is under ${parent} — budgets are set on top-level categories. Try: set ${parent.toLowerCase()} budget to 300`;
}

/** The name is an income category: budgets are for spending. */
export function incomeCategoryText(name: string): string {
  return `${name} is an income category; budgets are for spending.`;
}

/** Edit or remove for a category that does not exist: never offer to create it. */
export function noCategoryText(name: string): string {
  return `You don't have a ${name} category.`;
}

/** "dining" -> "Dining": the user's words, shown back as a name. */
export function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** The dashboard's card for a month with no budgets (not the current month). */
export function emptyBudgetCardCopy(
  month: MonthKey,
  now: number
): { title: string; hint: string; accessibilityLabel: string } {
  const label = monthLabel(month, now);
  return {
    title: `No budgets in ${label}`,
    hint: `Tap to add budgets for ${label}`,
    accessibilityLabel: `No budgets in ${label}. Open budget`,
  };
}
