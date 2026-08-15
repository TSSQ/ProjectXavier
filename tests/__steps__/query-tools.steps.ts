/**
 * BDD suite for src/domain/queryTools.ts (docs/design/ask-xavier-queries-
 * spec.md §5.2/§7 acceptance #3) — every executor against fixture data,
 * including transfer exclusion from spend/income and the "unresolvable name
 * -> unfiltered + flagged, never silent-zero" rule.
 */
import {
  totalSpent,
  totalIncome,
  spendingByCategory,
  spendingOverTime,
  topPayees,
  netWorthTool,
  searchTransactions,
  executeQueryTool,
  applyDeterministicPeriodOverride,
  QueryToolContext,
  QueryToolCall,
} from '../../src/domain/queryTools';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // Wed 15 July 2026

const accounts: Account[] = [
  { id: 'acc-checking', name: 'Checking', currency: 'USD', openingBalance: 100_000 },
  { id: 'acc-savings', name: 'Savings', currency: 'USD', openingBalance: 500_000 },
];

const categories: Category[] = [
  { id: 'cat-dining', name: 'Dining', kind: 'expense' },
  { id: 'cat-groceries', name: 'Groceries', kind: 'expense' },
  { id: 'cat-salary', name: 'Salary', kind: 'income' },
];

const payees: Payee[] = [
  { id: 'payee-joes', name: "Joe's Diner" },
  { id: 'payee-wholefoods', name: 'Whole Foods' },
];

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'occurredAt' | 'accountId'>): Transaction {
  return {
    currency: 'USD',
    createdAt: overrides.occurredAt,
    source: 'manual',
    pending: false,
    ...overrides,
  };
}

const transactions: Transaction[] = [
  // This month (July 2026): dining expense at Joe's.
  tx({
    id: 'tx-1',
    type: 'expense',
    amount: 2_000,
    occurredAt: Date.UTC(2026, 6, 5),
    accountId: 'acc-checking',
    categoryId: 'cat-dining',
    payeeId: 'payee-joes',
  }),
  // This month: groceries expense at Whole Foods.
  tx({
    id: 'tx-2',
    type: 'expense',
    amount: 5_000,
    occurredAt: Date.UTC(2026, 6, 10),
    accountId: 'acc-checking',
    categoryId: 'cat-groceries',
    payeeId: 'payee-wholefoods',
  }),
  // This month: salary income.
  tx({
    id: 'tx-3',
    type: 'income',
    amount: 300_000,
    occurredAt: Date.UTC(2026, 6, 1),
    accountId: 'acc-checking',
    categoryId: 'cat-salary',
  }),
  // This month: a transfer between the user's own accounts — must count as
  // NEITHER spend nor income.
  tx({
    id: 'tx-4',
    type: 'transfer',
    amount: 10_000,
    occurredAt: Date.UTC(2026, 6, 12),
    accountId: 'acc-checking',
    transferAccountId: 'acc-savings',
  }),
  // Last month: another dining expense — must be excluded from this_month
  // ranges.
  tx({
    id: 'tx-5',
    type: 'expense',
    amount: 1_500,
    occurredAt: Date.UTC(2026, 5, 20),
    accountId: 'acc-checking',
    categoryId: 'cat-dining',
    payeeId: 'payee-joes',
  }),
  // This month: a PENDING expense — must be excluded from every aggregate.
  tx({
    id: 'tx-6',
    type: 'expense',
    amount: 9_999,
    occurredAt: Date.UTC(2026, 6, 14),
    accountId: 'acc-checking',
    categoryId: 'cat-dining',
    pending: true,
  }),
];

const ctx: QueryToolContext = { accounts, transactions, categories, payees, now: NOW };

describe('totalSpent', () => {
  it('sums expenses in the period, excluding transfers and pending', () => {
    const result = totalSpent(ctx, { period: 'this_month' });
    expect(result.amountMinor).toBe(7_000); // 2000 + 5000, not the transfer or pending 9999
    expect(result.count).toBe(2);
    expect(result.notes).toEqual([]);
  });

  it('filters by a resolvable category name', () => {
    const result = totalSpent(ctx, { period: 'this_month', category: 'Dining' });
    expect(result.amountMinor).toBe(2_000);
    expect(result.notes).toEqual([]);
  });

  it('an unresolvable category name runs UNFILTERED and flags a note (never silent-zero)', () => {
    const result = totalSpent(ctx, { period: 'this_month', category: 'Nonexistent Category' });
    expect(result.amountMinor).toBe(7_000); // unfiltered — same as no category at all
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toMatch(/couldn't find category/);
  });

  it('filters by payee and account together', () => {
    const result = totalSpent(ctx, {
      period: 'this_month',
      payee: "Joe's Diner",
      account: 'Checking',
    });
    expect(result.amountMinor).toBe(2_000);
  });
});

describe('totalIncome', () => {
  it('sums income in the period, excluding transfers', () => {
    const result = totalIncome(ctx, { period: 'this_month' });
    expect(result.amountMinor).toBe(300_000);
    expect(result.count).toBe(1);
  });

  it('last_month has no income', () => {
    const result = totalIncome(ctx, { period: 'last_month' });
    expect(result.amountMinor).toBe(0);
  });
});

describe('spendingByCategory', () => {
  it('breaks spending down by category, sorted descending', () => {
    const result = spendingByCategory(ctx, { period: 'this_month' });
    expect(result.slices.map((s) => s.name)).toEqual(['Groceries', 'Dining']);
    expect(result.slices[0]!.amountMinor).toBe(5_000);
    expect(result.slices[1]!.amountMinor).toBe(2_000);
  });
});

describe('spendingOverTime', () => {
  it('buckets spending by month across all_time, including empty buckets', () => {
    const result = spendingOverTime(ctx, { period: 'all_time', granularity: 'month' });
    const totalAcrossBuckets = result.series.reduce((sum, p) => sum + p.amountMinor, 0);
    expect(totalAcrossBuckets).toBe(8_500); // 2000 + 5000 (July) + 1500 (June)
  });

  it('filters by category', () => {
    const result = spendingOverTime(ctx, {
      period: 'all_time',
      granularity: 'month',
      category: 'Dining',
    });
    const totalAcrossBuckets = result.series.reduce((sum, p) => sum + p.amountMinor, 0);
    expect(totalAcrossBuckets).toBe(3_500); // 2000 (July) + 1500 (June)
  });
});

describe('topPayees', () => {
  it('ranks payees by total spend, descending, clamped to n', () => {
    const result = topPayees(ctx, { period: 'this_month', n: 1 });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.name).toBe('Whole Foods');
    expect(result.rows[0]!.amountMinor).toBe(5_000);
  });
});

describe('netWorthTool', () => {
  it('reports the current net worth (sum of every account balance) with no params', () => {
    const result = netWorthTool(ctx, {});
    // 100000 opening + 2000+5000+9999(pending excl.) expenses out, +300000 in,
    // -10000/+10000 transfer wash, -1500 last-month expense too.
    const expected = 100_000 - 2_000 - 5_000 + 300_000 - 10_000 - 1_500 + 500_000 + 10_000;
    expect(result.amountMinor).toBe(expected);
  });

  it('reports a series when series=true', () => {
    const result = netWorthTool(ctx, { series: true, asOf: 'this_year' });
    expect(result.series).toBeDefined();
    expect(result.series!.length).toBeGreaterThan(0);
  });
});

describe('searchTransactions', () => {
  it('returns matching rows, newest first, excluding pending, respecting limit', () => {
    const result = searchTransactions(ctx, { period: 'this_month', limit: 2 });
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]!.id).toBe('tx-4'); // newest first (12 July transfer)
    expect(result.rows.every((r) => r.id !== 'tx-6')).toBe(true); // pending excluded
  });

  it('an unresolvable payee name runs unfiltered and flags a note', () => {
    const result = searchTransactions(ctx, { period: 'this_month', payee: 'Nobody', limit: 20 });
    expect(result.notes.length).toBe(1);
    expect(result.rows.length).toBeGreaterThan(0); // unfiltered, not silently empty
  });
});

describe('executeQueryTool dispatch', () => {
  it('routes to the matching executor by tool name', () => {
    const result = executeQueryTool(ctx, { tool: 'total_spent', params: { period: 'this_month' } });
    expect((result as { amountMinor: number }).amountMinor).toBe(7_000);
  });
});

// ─── QA BLOCKER 2 / MAJOR 2 follow-up: defense-in-depth against malformed
// runtime params reaching an executor directly (independent of queryLoop.ts's
// own zod validation layer — a tool executor must be safe on its own too). ──
describe('defense-in-depth against malformed runtime params (QA BLOCKER/MAJOR follow-up)', () => {
  it('spendingOverTime never hangs on an out-of-enum granularity — falls back to "day" and completes quickly', () => {
    const start = Date.now();
    const result = spendingOverTime(ctx, {
      period: 'this_month',
      // Bypasses the TS type on purpose — simulates a malformed runtime
      // value slipping past a caller's own validation.
      granularity: 'fortnight' as unknown as 'day',
    });
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(Array.isArray(result.series)).toBe(true);
    expect(result.series.length).toBeGreaterThan(0);
  });

  it('spendingOverTime never hangs across an all_time range with a bad granularity either', () => {
    const start = Date.now();
    const result = spendingOverTime(ctx, {
      period: 'all_time',
      granularity: 'fortnight' as unknown as 'day',
    });
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(result.series.length).toBeGreaterThan(0);
  });

  it('topPayees defaults a non-finite n to a sane value instead of silently returning zero rows', () => {
    const result = topPayees(ctx, { period: 'this_month', n: NaN });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('searchTransactions defaults a non-finite limit to a sane value instead of silently returning zero rows', () => {
    const result = searchTransactions(ctx, { period: 'this_month', limit: NaN });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('netWorthTool series never hangs even given an all_time asOf', () => {
    const start = Date.now();
    const result = netWorthTool(ctx, { series: true, asOf: 'all_time' });
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(result.series!.length).toBeGreaterThan(0);
  });

  it('totalSpent never throws given a completely missing period (root-cause reproduction)', () => {
    expect(() =>
      totalSpent(ctx, {} as unknown as { period: 'this_month' })
    ).not.toThrow();
    const result = totalSpent(ctx, {} as unknown as { period: 'this_month' });
    expect(typeof result.amountMinor).toBe('number');
  });
});

// ─── QA BUG 1 (device testing, build 55): sentinel filter values ("none",
// "any", etc.) must be treated as ABSENT, never as a real (unresolvable)
// name — no bogus "couldn't find 'none'" note, and no accidental filtering. ─
describe('sentinel filter values are treated as ABSENT, not as a real name (QA BUG 1)', () => {
  it.each(['none', 'None', ' NONE ', 'any', 'all', 'n/a', 'na', 'unspecified', 'null', ''])(
    'total_spent: category=%p is absent — unfiltered, and no "couldn\'t find" note',
    (sentinel) => {
      const result = totalSpent(ctx, { period: 'this_month', category: sentinel });
      expect(result.amountMinor).toBe(7_000); // same unfiltered total as no category at all
      expect(result.notes).toEqual([]);
    }
  );

  it('total_spent: payee/account sentinels are ALSO absent, with no notes', () => {
    const result = totalSpent(ctx, {
      period: 'this_month',
      category: 'none',
      payee: 'any',
      account: 'n/a',
    });
    expect(result.amountMinor).toBe(7_000);
    expect(result.notes).toEqual([]);
  });

  it('a REAL-but-unknown name ("Shopping") is NOT a sentinel — still gets the honest "couldn\'t find" note', () => {
    const result = totalSpent(ctx, { period: 'this_month', category: 'Shopping' });
    expect(result.amountMinor).toBe(7_000); // still runs unfiltered
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toMatch(/couldn't find category "Shopping"/);
  });

  it('search_transactions treats a sentinel category the same way (it has its own inline resolution, not resolveCategory)', () => {
    const result = searchTransactions(ctx, { period: 'this_month', category: 'none', limit: 20 });
    expect(result.notes).toEqual([]);
  });

  it('a resolvable name still resolves normally (sentinel handling does not break real filtering)', () => {
    const result = totalSpent(ctx, { period: 'this_month', category: 'Dining' });
    expect(result.amountMinor).toBe(2_000);
    expect(result.resolvedCategory).toBe('Dining');
    expect(result.notes).toEqual([]);
  });
});

// ─── QA MAJOR 1 follow-up: a REAL entity named like a sentinel must still
// resolve and filter — a real match always wins over the sentinel reading. ──
describe('a REAL entity named like a sentinel still resolves and filters (QA MAJOR 1)', () => {
  const noneCategory: Category = { id: 'cat-none', name: 'None', kind: 'expense' };
  const diningCategory: Category = { id: 'cat-dining-2', name: 'Dining', kind: 'expense' };
  const allAccount: Account = { id: 'acc-all', name: 'All', currency: 'USD', openingBalance: 0 };
  const savingsAccount2: Account = { id: 'acc-savings-2', name: 'Savings', currency: 'USD', openingBalance: 0 };

  const localCategories: Category[] = [noneCategory, diningCategory];
  const localAccounts: Account[] = [allAccount, savingsAccount2];
  const localTransactions: Transaction[] = [
    tx({
      id: 'tx-none-cat',
      type: 'expense',
      amount: 1_000,
      occurredAt: Date.UTC(2026, 6, 5),
      accountId: 'acc-all',
      categoryId: 'cat-none',
    }),
    tx({
      id: 'tx-dining-cat',
      type: 'expense',
      amount: 3_000,
      occurredAt: Date.UTC(2026, 6, 6),
      accountId: 'acc-savings-2',
      categoryId: 'cat-dining-2',
    }),
  ];
  const localCtx: QueryToolContext = {
    accounts: localAccounts,
    transactions: localTransactions,
    categories: localCategories,
    payees: [],
    now: NOW,
  };

  it('a real category named "None" resolves and FILTERS (previously silently dropped, no note at all)', () => {
    const result = totalSpent(localCtx, { period: 'this_month', category: 'None' });
    expect(result.amountMinor).toBe(1_000); // ONLY the "None"-category transaction
    expect(result.resolvedCategory).toBe('None');
    expect(result.notes).toEqual([]);
  });

  it('a real account named "All" resolves and FILTERS (not treated as no-filter)', () => {
    const result = totalSpent(localCtx, { period: 'this_month', account: 'All' });
    expect(result.amountMinor).toBe(1_000); // ONLY the transaction on the "All" account
    expect(result.resolvedAccount).toBe('All');
    expect(result.notes).toEqual([]);
  });

  it('search_transactions: a real category named "None" also resolves and filters (own inline path)', () => {
    const result = searchTransactions(localCtx, { period: 'this_month', category: 'None', limit: 20 });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe('tx-none-cat');
    expect(result.resolvedCategory).toBe('None');
    expect(result.notes).toEqual([]);
  });

  it('a pure sentinel with NO matching real entity in THIS context still means unfiltered, no note', () => {
    // This context has no category literally named "any" — so "any" here is
    // genuinely just the sentinel, not a real (if oddly-named) entity.
    const result = totalSpent(localCtx, { period: 'this_month', category: 'any' });
    expect(result.amountMinor).toBe(4_000); // unfiltered — both transactions
    expect(result.notes).toEqual([]);
  });
});

// ─── QA device bug (build 57): the model must NEVER choose the period —
// `applyDeterministicPeriodOverride` replaces it with whatever
// `resolvePeriodFromText` deterministically extracts from the user's own
// words, mirroring the expense parser's date-override pattern. ────────────
describe('applyDeterministicPeriodOverride (QA device bug, build 57)', () => {
  const income2025: Transaction = tx({
    id: 'tx-income-2025',
    type: 'income',
    amount: 1_000_000,
    occurredAt: Date.UTC(2025, 5, 1),
    accountId: 'acc-checking',
    categoryId: 'cat-salary',
  });
  const localCtx: QueryToolContext = {
    accounts,
    transactions: [...transactions, income2025],
    categories,
    payees,
    now: NOW,
  };

  it('replaces a WRONG model-chosen period ("this_month") with the deterministic explicit year from the text', () => {
    const modelCall: QueryToolCall = { tool: 'total_income', params: { period: 'this_month' } };
    const overridden = applyDeterministicPeriodOverride(modelCall, 'how much income for year 2025', NOW);

    expect((overridden.params as { period: unknown }).period).toEqual({ kind: 'year', year: 2025 });

    // End-to-end: executing the OVERRIDDEN call returns the 2025 income
    // (1,000,000), never the this-month figure (300,000) the model asked for.
    const result = executeQueryTool(localCtx, overridden) as { amountMinor: number };
    expect(result.amountMinor).toBe(1_000_000);
  });

  it('leaves the call COMPLETELY untouched (same object) when the text states no period at all', () => {
    const modelCall: QueryToolCall = { tool: 'total_income', params: { period: 'this_month' } };
    const overridden = applyDeterministicPeriodOverride(modelCall, 'how much income do I have', NOW);
    expect(overridden).toBe(modelCall);
  });

  it('overrides net_worth\'s "asOf" field (it has no "period" field at all)', () => {
    const modelCall: QueryToolCall = { tool: 'net_worth', params: { series: false } };
    const overridden = applyDeterministicPeriodOverride(modelCall, 'what was my net worth in 2025', NOW);
    expect(overridden.params).toEqual({ series: false, asOf: { kind: 'year', year: 2025 } });
  });

  it('a relative phrase in the text ALSO overrides — not just explicit years', () => {
    const modelCall: QueryToolCall = { tool: 'total_spent', params: { period: 'this_year' } };
    const overridden = applyDeterministicPeriodOverride(modelCall, 'how much did I spend last month', NOW);
    expect((overridden.params as { period: unknown }).period).toBe('last_month');
  });
});

// ─── docs/design/future-dated-transactions-spec.md §5 acceptance criterion
// 6: EVERY tool must exclude a future-dated row — spending includes it and
// net worth doesn't is exactly the disagreement the spec exists to close
// (spec §3). Own isolated fixture (same shape as the "QA MAJOR 1" /
// "applyDeterministicPeriodOverride" blocks above): a past row that DOES
// count, and future expense/income rows (dated the 25th, `ctx.now` the
// 15th — the spec's own motivating example) that must not appear in any
// tool's result. ───────────────────────────────────────────────────────────
describe('every query tool excludes a future-dated row (future-dated-transactions-spec §5.6)', () => {
  const futureAccounts: Account[] = [
    { id: 'acc-fd', name: 'Checking', currency: 'USD', openingBalance: 100_000 },
  ];
  const futureCategories: Category[] = [
    { id: 'cat-fd-dining', name: 'Dining', kind: 'expense' },
  ];
  const futurePayees: Payee[] = [{ id: 'payee-fd', name: 'Corner Cafe' }];

  // This month (July 2026), before `now` (the 15th) — counts everywhere.
  const pastExpense = tx({
    id: 'tx-fd-past-expense',
    type: 'expense',
    amount: 2_000,
    occurredAt: Date.UTC(2026, 6, 5),
    accountId: 'acc-fd',
    categoryId: 'cat-fd-dining',
    payeeId: 'payee-fd',
  });
  // Dated the 25th — after `now` (the 15th) — must be excluded everywhere,
  // exactly the spec §3 scenario ("entered on the 5th" would be the same
  // trap for a row dated later in the same month).
  const futureExpense = tx({
    id: 'tx-fd-future-expense',
    type: 'expense',
    amount: 50_000,
    occurredAt: Date.UTC(2026, 6, 25),
    accountId: 'acc-fd',
    categoryId: 'cat-fd-dining',
    payeeId: 'payee-fd',
  });
  const futureIncome = tx({
    id: 'tx-fd-future-income',
    type: 'income',
    amount: 900_000,
    occurredAt: Date.UTC(2026, 6, 25),
    accountId: 'acc-fd',
  });
  const futureCtx: QueryToolContext = {
    accounts: futureAccounts,
    transactions: [pastExpense, futureExpense, futureIncome],
    categories: futureCategories,
    payees: futurePayees,
    now: NOW,
  };

  it('total_spent for "this month" excludes a future-dated row inside the month', () => {
    const result = totalSpent(futureCtx, { period: 'this_month' });
    expect(result.amountMinor).toBe(2_000); // NOT +50,000
    expect(result.count).toBe(1);
  });

  it('total_income excludes a future-dated row', () => {
    const result = totalIncome(futureCtx, { period: 'this_month' });
    expect(result.amountMinor).toBe(0); // the only income row is future-dated
    expect(result.count).toBe(0);
  });

  it('spending_by_category excludes a future-dated row', () => {
    const result = spendingByCategory(futureCtx, { period: 'this_month' });
    expect(result.slices).toEqual([
      { categoryId: 'cat-fd-dining', name: 'Dining', amountMinor: 2_000 },
    ]);
  });

  it('spending_over_time excludes a future-dated row from its bucket', () => {
    const result = spendingOverTime(futureCtx, { period: 'this_month', granularity: 'day' });
    const totalAcrossBuckets = result.series.reduce((sum, p) => sum + p.amountMinor, 0);
    expect(totalAcrossBuckets).toBe(2_000);
  });

  it('top_payees excludes a future-dated row', () => {
    const result = topPayees(futureCtx, { period: 'this_month', n: 5 });
    expect(result.rows).toEqual([
      { payeeId: 'payee-fd', name: 'Corner Cafe', amountMinor: 2_000, count: 1 },
    ]);
  });

  it('net_worth excludes a future-dated row', () => {
    const result = netWorthTool(futureCtx, {});
    expect(result.amountMinor).toBe(100_000 - 2_000); // NOT the future expense/income
  });

  it('search_transactions excludes a future-dated row', () => {
    const result = searchTransactions(futureCtx, { period: 'this_month', limit: 20 });
    expect(result.rows.map((r) => r.id)).toEqual(['tx-fd-past-expense']);
  });
});
