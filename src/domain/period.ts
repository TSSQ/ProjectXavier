/**
 * Time-period grouping and totals for dashboard drill-down
 * (day / week / month / year). All calculations are UTC-based and pure.
 */
import { Transaction } from './types';

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

/** Totals (expense/income/net) for the transactions within a range. */
export function totalsForRange(
  transactions: Transaction[],
  range: PeriodRange
): PeriodTotals {
  let expense = 0;
  let income = 0;
  for (const tx of transactions) {
    if (!inRange(tx, range)) continue;
    if (tx.type === 'expense') expense += tx.amount;
    else if (tx.type === 'income') income += tx.amount;
    // transfers move money between own accounts: ignored for income/expense.
  }
  return { expense, income, net: income - expense };
}

/** Start of the period containing `epoch`, in UTC, as epoch ms. */
export function startOfPeriod(epoch: number, granularity: Granularity): number {
  const d = new Date(epoch);
  switch (granularity) {
    case 'day':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    case 'week': {
      // ISO week: Monday as first day.
      const day = d.getUTCDay(); // 0 = Sun
      const diff = (day + 6) % 7; // days since Monday
      const monday = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() - diff
      );
      return monday;
    }
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case 'year':
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    default:
      return epoch;
  }
}

/** End (exclusive) of the period that starts at `start`, in UTC. */
export function endOfPeriod(start: number, granularity: Granularity): number {
  const d = new Date(start);
  switch (granularity) {
    case 'day':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    case 'week':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7);
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    case 'year':
      return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
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
 * ordered by time. Useful for charts (e.g. monthly spend over a year).
 */
export function groupByPeriod(
  transactions: Transaction[],
  granularity: Granularity
): Array<{ start: number; totals: PeriodTotals }> {
  const buckets = new Map<number, PeriodTotals>();
  for (const tx of transactions) {
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
