/**
 * The mockup's October fixture (docs/design/monthly-budgets-spec.md §7.2),
 * built once for every budget scenario that needs it. Today is Oct 18, 2026.
 * Dates are LOCAL, like the app's own month maths.
 */
import { Category, RecurringSeries, Transaction } from '../../src/domain/types';
import { BudgetRow } from '../../src/domain/budgets';

export const local = (y: number, m: number, d: number, h = 12): number =>
  new Date(y, m - 1, d, h, 0, 0, 0).getTime();

/** Oct 18, 2026, 10:00 local. */
export const NOW = local(2026, 10, 18, 10);

export const cat = (id: string, name: string, icon: string, parentId: string | null = null): Category => ({
  id,
  name,
  kind: 'expense',
  parentId,
  icon,
});

export const FIXTURE_CATEGORIES: Category[] = [
  cat('dining', 'Dining', '🍔'),
  cat('shopping', 'Shopping', '🛍️'),
  cat('groceries', 'Groceries', '🛒'),
  cat('transport', 'Transport', '🚌'),
  cat('entertainment', 'Entertainment', '🎬'),
  cat('health', 'Health', '💊'),
  cat('bills', 'Bills', '🧾'),
  cat('gifts', 'Gifts', '🎁'),
];

export const budgetRow = (
  categoryId: string,
  major: number | null,
  start: string,
  end: string | null = null,
  createdAt = 1
): BudgetRow => ({
  id: `b-${categoryId}-${start}-${createdAt}`,
  categoryId,
  amount: major === null ? null : major * 100,
  startMonth: start,
  endMonth: end,
  createdAt,
});

export const FIXTURE_BUDGETS: BudgetRow[] = [
  budgetRow('dining', 600, '2026-01'),
  budgetRow('shopping', 300, '2026-01'),
  budgetRow('groceries', 400, '2026-01'),
  budgetRow('transport', 200, '2026-01'),
  budgetRow('entertainment', 150, '2026-01'),
  budgetRow('health', 100, '2026-01'),
  budgetRow('bills', 350, '2026-01'),
];

let n = 0;
export const expenseTx = (
  categoryId: string | null,
  major: number,
  when: number,
  extra: Partial<Transaction> = {}
): Transaction => ({
  id: `t-${++n}`,
  accountId: 'acc-1',
  type: 'expense',
  amount: Math.round(major * 100),
  currency: 'USD',
  categoryId,
  payeeId: null,
  transferAccountId: null,
  note: null,
  occurredAt: when,
  createdAt: when,
  source: 'manual',
  receiptRef: null,
  pending: false,
  ...extra,
});

export const monthlySeries = (
  id: string,
  categoryId: string,
  major: number,
  anchor: number,
  extra: Partial<RecurringSeries> = {}
): RecurringSeries => ({
  id,
  rule: { freq: 'monthly', interval: 1, byDay: null, anchor, end: { kind: 'never' } },
  template: {
    accountId: 'acc-1',
    type: 'expense',
    amount: Math.round(major * 100),
    currency: 'USD',
    categoryId,
    payeeId: null,
    transferAccountId: null,
    note: null,
  },
  lastPostedAt: null,
  postedCount: 1,
  paused: false,
  skippedDates: [],
  createdAt: anchor,
  archived: false,
  ...extra,
});

/** A transaction posted from `series` for the occurrence on `occurrence`. */
export const postedFrom = (series: RecurringSeries, occurrence: number): Transaction =>
  expenseTx(series.template.categoryId ?? null, series.template.amount / 100, occurrence, {
    seriesId: series.id,
    occurrenceDate: occurrence,
  });

export interface Fixture {
  transactions: Transaction[];
  series: RecurringSeries[];
}

/** Every Oct 18 figure from the mockup: spent 1,287 across the budgets,
 *  150 scheduled (Singtel Fibre recurring Oct 22 + AIA Insurance future-dated
 *  Oct 28), Bills' two paid rows posted from recurring series (fixed = 322),
 *  and Gifts 45 with no budget. */
export function mockupFixture(): Fixture {
  const mobile = monthlySeries('s-mobile', 'bills', 42, local(2026, 9, 3));
  const sp = monthlySeries('s-sp', 'bills', 130, local(2026, 9, 9));
  const singtel = monthlySeries('s-singtel', 'bills', 50, local(2026, 10, 22), { postedCount: 0 });
  const transactions: Transaction[] = [
    expenseTx('dining', 300, local(2026, 10, 5)),
    expenseTx('dining', 112, local(2026, 10, 14)),
    expenseTx('shopping', 180, local(2026, 10, 7)),
    expenseTx('groceries', 236, local(2026, 10, 10)),
    expenseTx('transport', 96, local(2026, 10, 11)),
    expenseTx('entertainment', 171, local(2026, 10, 12)),
    expenseTx('health', 20, local(2026, 10, 13)),
    postedFrom(mobile, local(2026, 10, 3)),
    postedFrom(sp, local(2026, 10, 9)),
    expenseTx('bills', 100, local(2026, 10, 28), { note: 'AIA Insurance' }),
    expenseTx('gifts', 45, local(2026, 10, 12)),
  ];
  return { transactions, series: [mobile, sp, singtel] };
}

/** The mockup fixture with the Dining rows moved onto a second account, so a
 *  filter that hides it would change a filtered total — budgets must not. */
export function twoAccountFixture(): Fixture {
  const f = mockupFixture();
  return {
    series: f.series,
    transactions: f.transactions.map((t, i) => (i % 2 ? { ...t, accountId: 'acc-2' } : t)),
  };
}
