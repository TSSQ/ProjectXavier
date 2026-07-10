/**
 * Time-period grouping and totals for dashboard drill-down
 * (day / week / month / year). Boundaries are computed in the device's local
 * timezone (timestamps are stored as UTC epoch ms), so periods follow the
 * user's calendar and re-bucket automatically if they change timezone. Pure.
 */
import { Transaction, isCounted } from './types';

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface PeriodTotals {
  expense: number;
  income: number;
  /** income - expense, in minor units. */
  net: number;
}

export interface PeriodRange {
  /** Inclusive start, epoch ms. */
  start: number;
  /** Exclusive end, epoch ms. */
  end: number;
}

/** True if a transaction falls within [start, end). */
export function inRange(tx: Transaction, range: PeriodRange): boolean {
  return tx.occurredAt >= range.start && tx.occurredAt < range.end;
}

/**
 * Totals (expense/income/net) for the transactions within a range. Pending
 * transactions are excluded (see domain/types.ts isCounted) — they re-enter
 * the total automatically once un-pended.
 */
export function totalsForRange(
  transactions: Transaction[],
  range: PeriodRange
): PeriodTotals {
  let expense = 0;
  let income = 0;
  for (const tx of transactions) {
    if (!inRange(tx, range) || !isCounted(tx)) continue;
    if (tx.type === 'expense') expense += tx.amount;
    else if (tx.type === 'income') income += tx.amount;
    // transfers move money between own accounts: ignored for income/expense.
  }
  return { expense, income, net: income - expense };
}

/** Start of the period containing `epoch`, in local time, as epoch ms. */
export function startOfPeriod(epoch: number, granularity: Granularity): number {
  const d = new Date(epoch);
  switch (granularity) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'week': {
      // ISO week: Monday as first day.
      const day = d.getDay(); // 0 = Sun
      const diff = (day + 6) % 7; // days since Monday
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff).getTime();
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'year':
      return new Date(d.getFullYear(), 0, 1).getTime();
    default:
      return epoch;
  }
}

/** End (exclusive) of the period that starts at `start`, in local time. */
export function endOfPeriod(start: number, granularity: Granularity): number {
  const d = new Date(start);
  switch (granularity) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    case 'month':
      return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    case 'year':
      return new Date(d.getFullYear() + 1, 0, 1).getTime();
    default:
      return start;
  }
}

/** Build a PeriodRange covering the whole period that contains `epoch`. */
export function periodRange(
  epoch: number,
  granularity: Granularity
): PeriodRange {
  const start = startOfPeriod(epoch, granularity);
  return { start, end: endOfPeriod(start, granularity) };
}

/**
 * Group transactions into consecutive period buckets and return their totals,
 * ordered by time. Useful for charts (e.g. monthly spend over a year). Pending
 * transactions are excluded (see isCounted).
 */
export function groupByPeriod(
  transactions: Transaction[],
  granularity: Granularity
): Array<{ start: number; totals: PeriodTotals }> {
  const buckets = new Map<number, PeriodTotals>();
  for (const tx of transactions) {
    if (!isCounted(tx)) continue;
    const start = startOfPeriod(tx.occurredAt, granularity);
    const bucket = buckets.get(start) ?? { expense: 0, income: 0, net: 0 };
    if (tx.type === 'expense') bucket.expense += tx.amount;
    else if (tx.type === 'income') bucket.income += tx.amount;
    bucket.net = bucket.income - bucket.expense;
    buckets.set(start, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, totals]) => ({ start, totals }));
}

export interface PeriodSummary {
  start: number;
  /** Exclusive end (== next period's start). */
  end: number;
  totals: PeriodTotals;
}

/**
 * Bucket income and expense totals across a continuous series of time periods
 * within `range`, including empty buckets (so the x-axis is gap-free). Useful
 * for bar charts: month-view → one bucket per day, year-view → per month.
 * Pending transactions are excluded (see isCounted).
 */
export function cashFlowSeries(
  transactions: Transaction[],
  range: PeriodRange,
  granularity: Granularity
): Array<{ start: number; income: number; expense: number }> {
  const buckets = new Map<number, { income: number; expense: number }>();
  for (const tx of transactions) {
    if (!inRange(tx, range) || !isCounted(tx)) continue;
    const key = startOfPeriod(tx.occurredAt, granularity);
    const b = buckets.get(key) ?? { income: 0, expense: 0 };
    if (tx.type === 'income') b.income += tx.amount;
    else if (tx.type === 'expense') b.expense += tx.amount;
    buckets.set(key, b);
  }
  const result: Array<{ start: number; income: number; expense: number }> = [];
  let cursor = startOfPeriod(range.start, granularity);
  while (cursor < range.end) {
    result.push({ start: cursor, ...(buckets.get(cursor) ?? { income: 0, expense: 0 }) });
    cursor = endOfPeriod(cursor, granularity);
  }
  return result;
}

/**
 * Periods that contain at least one transaction, newest first. Quiet periods
 * are omitted. Returns [] when there are no transactions.
 */
export function activePeriods(
  transactions: Transaction[],
  granularity: Granularity
): PeriodSummary[] {
  return groupByPeriod(transactions, granularity)
    .map(({ start, totals }) => ({
      start,
      end: endOfPeriod(start, granularity),
      totals,
    }))
    .reverse(); // groupByPeriod is oldest-first; show newest first
}

/** A category's share of a period's expense/income total, for the dashboard's
 *  donut charts. `amount` is a positive magnitude in minor units. */
export interface CategorySlice {
  /** null = uncategorised — collapses every uncategorised txn into one slice. */
  categoryId: string | null;
  amount: number;
}

/**
 * Sum `amount` by `categoryId` for transactions of `type` within `range`.
 * Transfers are excluded implicitly (the `type` filter only matches
 * expense/income); pending transactions are excluded (see isCounted). Slices
 * are sorted by amount, descending.
 */
export function categoryBreakdown(
  transactions: Transaction[],
  range: PeriodRange,
  type: 'expense' | 'income'
): CategorySlice[] {
  const byCategory = new Map<string | null, number>();
  for (const tx of transactions) {
    if (tx.type !== type || !inRange(tx, range) || !isCounted(tx)) continue;
    const key = tx.categoryId ?? null;
    byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amount);
  }
  return [...byCategory.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount);
}
