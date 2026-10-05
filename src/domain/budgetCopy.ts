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
  monthName,
} from './budgets';

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

/** "dining" -> "Dining": the user's words, shown back as a name. */
export function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
