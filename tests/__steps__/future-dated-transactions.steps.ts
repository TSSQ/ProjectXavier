/**
 * BDD suite for docs/design/future-dated-transactions-spec.md §5 acceptance
 * criteria 1-4 and 7-9 (criteria 5/6 are covered elsewhere — see criterion 5's
 * step comment below and tests/__steps__/query-tools.steps.ts for criterion
 * 6; criteria 10-11 are device-only, out of this Node suite). Every scenario
 * injects its own clock — no `Date.now()` anywhere in this file — matching
 * the spec's own house rule for `isCounted`.
 */
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, RecurringSeries, Transaction, isCounted, isUpcoming } from '../../src/domain/types';
import {
  Granularity,
  PeriodRange,
  PeriodTotals,
  CategorySlice,
  periodRange,
  startOfPeriod,
  totalsForRange,
  groupByPeriod,
  cashFlowSeries,
  categoryBreakdown,
} from '../../src/domain/period';
import { accountBalance, netWorth, netWorthAsOf } from '../../src/domain/balances';
import { dueOccurrences } from '../../src/domain/recurrence';
import { localDayNoon } from '../../src/domain/dates';
import { buildBackupDataFromRows, RawBackupRows, RawRow } from '../../src/domain/sqliteBackupRows';
import { BackupData, serializeBackup, parseBackup } from '../../src/lib/backup';
import { makeAccount, makeTransaction, money, dateToEpoch, nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/future-dated-transactions.feature')
);

function rangeForMonth(label: string): PeriodRange {
  const [y, m] = label.split('-').map(Number);
  return periodRange(Date.UTC(y!, (m ?? 1) - 1, 1), 'month');
}

/** Parse a "YYYY-MM" label into the epoch ms of that month's start (UTC),
 *  matching startOfPeriod('month') so bucket lookups line up exactly. */
function monthStart(label: string): number {
  const [y, m] = label.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, 1);
}

/** Occurrence dates coming out of the recurrence engine are local-noon
 *  epochs — wrap the UTC-midnight test fixture dates the same way (mirrors
 *  recurring.steps.ts's own helper). */
const expectedDay = (date: string): number => localDayNoon(dateToEpoch(date));

defineFeature(feature, (test) => {
  let now: number;
  let tx: Transaction;
  let transactions: Transaction[] = [];
  let accounts: Record<string, Account> = {};
  let range: PeriodRange;

  beforeEach(() => {
    transactions = [];
    accounts = {};
  });

  // ── Shared step bodies (reused across the isCounted/isUpcoming scenarios) ─
  const setNow = (date: string) => {
    now = dateToEpoch(date);
  };
  const addTransactionDated = (date: string) => {
    tx = makeTransaction({
      type: 'expense',
      amount: money('10.00'),
      accountId: 'acc-1',
      occurredAt: dateToEpoch(date),
    });
  };
  const addPendingTransactionDated = (date: string) => {
    tx = makeTransaction({
      type: 'expense',
      amount: money('10.00'),
      accountId: 'acc-1',
      occurredAt: dateToEpoch(date),
      pending: true,
    });
  };

  // ── isCounted (criteria 1 and 7) ─────────────────────────────────────────

  test('A future-dated transaction is not counted', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a transaction dated "([^"]+)"$/, addTransactionDated);
    then(/^the transaction should not be counted$/, () => {
      expect(isCounted(tx, now)).toBe(false);
    });
  });

  test('A transaction dated exactly now is counted (the boundary)', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a transaction dated "([^"]+)"$/, addTransactionDated);
    then(/^the transaction should be counted$/, () => {
      expect(isCounted(tx, now)).toBe(true);
    });
  });

  test('A past-dated transaction is counted', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a transaction dated "([^"]+)"$/, addTransactionDated);
    then(/^the transaction should be counted$/, () => {
      expect(isCounted(tx, now)).toBe(true);
    });
  });

  test('A pending transaction is never counted, regardless of date', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a pending transaction dated "([^"]+)"$/, addPendingTransactionDated);
    then(/^the transaction should not be counted$/, () => {
      expect(isCounted(tx, now)).toBe(false);
    });
  });

  // ── totalsForRange (criterion 2) ─────────────────────────────────────────

  interface Row {
    type: string;
    amount: string;
    date: string;
  }
  const loadTable = (table: Row[]) => {
    transactions = table.map((r) =>
      makeTransaction({
        type: r.type as Transaction['type'],
        amount: money(r.amount),
        accountId: 'acc-1',
        occurredAt: dateToEpoch(r.date),
      })
    );
  };
  const viewTotals = (label: string) => {
    range = rangeForMonth(label);
  };

  test('totalsForRange excludes a future-dated row within the range', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and('the following transactions:', loadTable);
    when(/^I view totals for "month" of "([^"]+)"$/, viewTotals);
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, now).expense).toBe(money(v))
    );
  });

  test('The same row counts once now passes its date', ({ given, and, when, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and('the following transactions:', loadTable);
    when(/^I view totals for "month" of "([^"]+)"$/, viewTotals);
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, now).expense).toBe(money(v))
    );
  });

  // ── Category donut and time buckets (criterion 3) ────────────────────────

  interface CategoryRow {
    type: string;
    category: string;
    amount: string;
    date: string;
  }
  const loadCategoryTable = (table: CategoryRow[]) => {
    transactions = table.map((r) =>
      makeTransaction({
        type: r.type as Transaction['type'],
        amount: money(r.amount),
        accountId: 'acc-1',
        occurredAt: dateToEpoch(r.date),
        categoryId: r.category,
      })
    );
  };

  test('categoryBreakdown excludes a future-dated row', ({ given, and, when, then }) => {
    let breakdown: CategorySlice[] = [];
    given(/^now is "([^"]+)"$/, setNow);
    and('the following categorised transactions:', loadCategoryTable);
    when(/^I compute the expense category breakdown for "([^"]+)"$/, (label) => {
      breakdown = categoryBreakdown(transactions, rangeForMonth(label), 'expense', now);
    });
    then(/^slice (\d+) should be category "([^"]+)" with amount (.*)$/, (i, name, amt) => {
      const slice = breakdown[Number(i) - 1]!;
      expect(slice.categoryId).toBe(name);
      expect(slice.amount).toBe(money(amt));
    });
  });

  test('groupByPeriod excludes a future-dated row from its bucket', ({
    given,
    and,
    when,
    then,
  }) => {
    let buckets: Array<{ start: number; totals: PeriodTotals }> = [];
    given(/^now is "([^"]+)"$/, setNow);
    and('the following transactions:', loadTable);
    when(/^I group transactions by "month"$/, () => {
      buckets = groupByPeriod(transactions, 'month' as Granularity, now);
    });
    then(/^the "([^"]+)" bucket expense total should be (.*)$/, (label, v) => {
      const bucket = buckets.find((b) => b.start === monthStart(label));
      expect(bucket?.totals.expense).toBe(money(v));
    });
  });

  test('cashFlowSeries excludes a future-dated row from its bucket', ({
    given,
    and,
    when,
    then,
  }) => {
    let flow: Array<{ start: number; income: number; expense: number }> = [];
    given(/^now is "([^"]+)"$/, setNow);
    and('the following transactions:', loadTable);
    when(/^I compute the cash flow series for "([^"]+)" by "day"$/, (label) => {
      flow = cashFlowSeries(transactions, periodRange(monthStart(label), 'month'), 'day', now);
    });
    then(/^the "([^"]+)" cash-flow expense should be (.*)$/, (label, v) => {
      const bucket = flow.find((b) => b.start === startOfPeriod(dateToEpoch(label), 'day'));
      expect(bucket?.expense).toBe(money(v));
    });
    and(/^the "([^"]+)" cash-flow expense should be (.*)$/, (label, v) => {
      const bucket = flow.find((b) => b.start === startOfPeriod(dateToEpoch(label), 'day'));
      expect(bucket?.expense).toBe(money(v));
    });
  });

  // ── accountBalance / netWorth (criterion 4) ──────────────────────────────

  const addAsset = (name: string, bal: string) => {
    accounts[name] = makeAccount({ name, tag: 'asset', openingBalance: money(bal) });
  };
  const addExpenseDatedFrom = (amt: string, date: string, name: string) => {
    transactions.push(
      makeTransaction({
        type: 'expense',
        amount: money(amt),
        accountId: accounts[name]!.id,
        occurredAt: dateToEpoch(date),
      })
    );
  };

  test('accountBalance excludes a future-dated transaction', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^an asset account "([^"]+)" with opening balance (.*)$/, addAsset);
    and(/^a (.*) expense dated "([^"]+)" from "([^"]+)"$/, addExpenseDatedFrom);
    then(/^the balance of "([^"]+)" should be (.*)$/, (name, expected) => {
      expect(accountBalance(accounts[name]!, transactions, now)).toBe(money(expected));
    });
  });

  test('netWorth excludes a future-dated transaction', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^an asset account "([^"]+)" with opening balance (.*)$/, addAsset);
    and(/^a (.*) expense dated "([^"]+)" from "([^"]+)"$/, addExpenseDatedFrom);
    then(/^the net worth should be (.*)$/, (expected) => {
      expect(netWorth(Object.values(accounts), transactions, now)).toBe(money(expected));
    });
  });

  // ── netWorthAsOf regression (criterion 4 — must NOT change) ──────────────

  test('netWorthAsOf still excludes a future-dated row when asOf is before its date', ({
    given,
    and,
    then,
  }) => {
    given(/^an asset account "([^"]+)" with opening balance (.*)$/, addAsset);
    and(/^a (.*) expense dated "([^"]+)" from "([^"]+)"$/, addExpenseDatedFrom);
    then(/^the net worth as of "([^"]+)" should be (.*)$/, (asOf, expected) => {
      expect(netWorthAsOf(Object.values(accounts), transactions, dateToEpoch(asOf))).toBe(
        money(expected)
      );
    });
  });

  test('netWorthAsOf still includes a row on or before asOf, even when asOf itself is in the future', ({
    given,
    and,
    then,
  }) => {
    given(/^an asset account "([^"]+)" with opening balance (.*)$/, addAsset);
    and(/^a (.*) expense dated "([^"]+)" from "([^"]+)"$/, addExpenseDatedFrom);
    then(/^the net worth as of "([^"]+)" should be (.*)$/, (asOf, expected) => {
      // This is the critical regression check (see balances.ts's own
      // comment): `asOf` here is itself LATER than the transaction's date but
      // may be earlier than, equal to, or later than actual "now" — none of
      // that matters. Only `asOf` governs inclusion, exactly as before this
      // spec shipped.
      expect(netWorthAsOf(Object.values(accounts), transactions, dateToEpoch(asOf))).toBe(
        money(expected)
      );
    });
  });

  // ── Backup round-trip (criterion 9) ──────────────────────────────────────

  test('A future-dated row round-trips through the current SQLite-backup restore path and stays uncounted', ({
    given,
    and,
    when,
    then,
  }) => {
    let rawRows: RawBackupRows;
    let restored: BackupData;
    let futureOccurredAt: number;

    given(/^now is "([^"]+)"$/, setNow);
    and(/^a raw transactions row dated "([^"]+)"$/, (date: string) => {
      futureOccurredAt = dateToEpoch(date);
      rawRows = {
        accounts: [],
        categories: [],
        payees: [],
        settings: [],
        transactions: [
          {
            id: 'tx-future',
            account_id: 'acc-1',
            type: 'expense',
            amount: 3000,
            currency: 'USD',
            category_id: null,
            payee_id: null,
            transfer_account_id: null,
            note: null,
            occurred_at: futureOccurredAt,
            created_at: futureOccurredAt,
            source: 'manual',
          } as RawRow,
        ],
        recurring_series: [],
      };
    });
    when(/^I build BackupData from the attached rows$/, () => {
      restored = buildBackupDataFromRows(rawRows);
    });
    then(/^the resulting transaction's occurredAt should be unchanged$/, () => {
      expect(restored.transactions[0]!.occurredAt).toBe(futureOccurredAt);
    });
    and(/^the resulting transaction should not be counted$/, () => {
      // No stored "scheduled"/"upcoming" flag exists on the restored row —
      // isCounted derives everything from occurredAt/pending alone, so there
      // is nothing here that can go stale (spec §4.1).
      expect(isCounted(restored.transactions[0]!, now)).toBe(false);
    });
  });

  test('A future-dated row round-trips through the legacy JSON backup format and stays uncounted', ({
    given,
    and,
    when,
    then,
  }) => {
    let original: BackupData;
    let restored: BackupData;
    let futureOccurredAt: number;

    given(/^now is "([^"]+)"$/, setNow);
    and(/^a backup dataset with a transaction dated "([^"]+)"$/, (date: string) => {
      futureOccurredAt = dateToEpoch(date);
      const acc = makeAccount({ name: 'Checking', openingBalance: money('100.00') });
      original = {
        accounts: [acc],
        categories: [],
        payees: [],
        transactions: [
          makeTransaction({
            type: 'expense',
            amount: money('30.00'),
            accountId: acc.id,
            occurredAt: futureOccurredAt,
          }),
        ],
        recurringSeries: [],
      };
    });
    when(/^I serialize and parse the backup$/, () => {
      const json = serializeBackup(original, dateToEpoch('2026-06-15'));
      restored = parseBackup(json).data;
    });
    then(/^the restored transaction's occurredAt should be unchanged$/, () => {
      expect(restored.transactions[0]!.occurredAt).toBe(futureOccurredAt);
    });
    and(/^the restored transaction should not be counted$/, () => {
      expect(isCounted(restored.transactions[0]!, now)).toBe(false);
    });
  });

  // ── Recurring series anchored in the future (criterion 8) ────────────────

  const anchorMonthlySeries = (anchor: string) => {
    return {
      id: nextId('series'),
      rule: {
        freq: 'monthly' as const,
        interval: 1,
        anchor: dateToEpoch(anchor),
        end: { kind: 'never' as const },
      },
      template: { accountId: 'acc-1', type: 'expense' as const, amount: 1000, currency: 'USD' },
      lastPostedAt: null,
      postedCount: 0,
      paused: false,
      skippedDates: [],
      createdAt: dateToEpoch('2026-01-01'),
      archived: false,
    };
  };

  test('A recurring series anchored in the future posts nothing before the anchor', ({
    given,
    when,
    then,
  }) => {
    let series: RecurringSeries;
    let dues: number[];
    given(/^a monthly series anchored on "([^"]+)" with no last post$/, (anchor: string) => {
      series = anchorMonthlySeries(anchor);
    });
    when(/^I check due occurrences as of "([^"]+)"$/, (asOf: string) => {
      dues = dueOccurrences(series, dateToEpoch(asOf));
    });
    then(/^due occurrences should be empty$/, () => {
      expect(dues).toEqual([]);
    });
  });

  test('The series posts once the anchor date arrives', ({ given, when, then }) => {
    let series: RecurringSeries;
    let dues: number[];
    given(/^a monthly series anchored on "([^"]+)" with no last post$/, (anchor: string) => {
      series = anchorMonthlySeries(anchor);
    });
    when(/^I check due occurrences as of "([^"]+)"$/, (asOf: string) => {
      dues = dueOccurrences(series, dateToEpoch(asOf));
    });
    then(/^due occurrences should be "([^"]+)"$/, (d1: string) => {
      expect(dues).toEqual([expectedDay(d1)]);
    });
  });

  test('The series keeps posting normally in later months once started', ({
    given,
    when,
    then,
  }) => {
    let series: RecurringSeries;
    let dues: number[];
    given(/^a monthly series anchored on "([^"]+)" with no last post$/, (anchor: string) => {
      series = anchorMonthlySeries(anchor);
    });
    when(/^I check due occurrences as of "([^"]+)"$/, (asOf: string) => {
      dues = dueOccurrences(series, dateToEpoch(asOf));
    });
    then(/^due occurrences should be "([^"]+)", "([^"]+)", "([^"]+)"$/, (d1, d2, d3) => {
      expect(dues).toEqual([d1, d2, d3].map(expectedDay));
    });
  });

  // ── isUpcoming — the "Upcoming" chip predicate (spec §4.3) ───────────────

  test('isUpcoming is true for a future-dated, non-pending transaction', ({
    given,
    and,
    then,
  }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a transaction dated "([^"]+)"$/, addTransactionDated);
    then(/^the transaction should be upcoming$/, () => {
      expect(isUpcoming(tx, now)).toBe(true);
    });
  });

  test('isUpcoming is false for a pending transaction even when future-dated', ({
    given,
    and,
    then,
  }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a pending transaction dated "([^"]+)"$/, addPendingTransactionDated);
    then(/^the transaction should not be upcoming$/, () => {
      expect(isUpcoming(tx, now)).toBe(false);
    });
  });

  test('isUpcoming is false for a past-dated transaction', ({ given, and, then }) => {
    given(/^now is "([^"]+)"$/, setNow);
    and(/^a transaction dated "([^"]+)"$/, addTransactionDated);
    then(/^the transaction should not be upcoming$/, () => {
      expect(isUpcoming(tx, now)).toBe(false);
    });
  });
// ── same-day, different time ─────────────────────────────────────────────
  // Local (not UTC) construction on purpose: these scenarios exist to pin the
  // behaviour at hours within one LOCAL calendar day, which is exactly what a
  // UTC fixture would smear across two.
  const localMs = (dateTime: string): number => {
    const [ymd, hm] = dateTime.split(' ');
    const [y, mo, d] = ymd!.split('-').map(Number) as [number, number, number];
    const [h, mi] = hm!.split(':').map(Number) as [number, number];
    return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  };
  const setNowLocal = (dateTime: string) => {
    now = localMs(dateTime);
  };
  const addTxLocal = (dateTime: string) => {
    tx = makeTransaction({ type: 'expense', amount: money('10.00'), accountId: 'acc-1', occurredAt: localMs(dateTime) });
  };
  const addPendingTxLocal = (dateTime: string) => {
    tx = makeTransaction({
      type: 'expense',
      amount: money('10.00'),
      accountId: 'acc-1',
      occurredAt: localMs(dateTime),
      pending: true,
    });
  };

  for (const [name, pending] of [
    ['A noon-dated row is counted from the start of that day', false],
    ['A row dated later today is still today', false],
    ['A row dated earlier today stays counted', false],
    ['A row dated just after midnight tomorrow is upcoming', false],
    ['Pending still wins over the day comparison', true],
  ] as const) {
    test(name, ({ given, and, then }) => {
      given(/^now is local "([^"]+)"$/, setNowLocal);
      and(
        /^an? (?:pending )?transaction dated local "([^"]+)"$/,
        pending ? addPendingTxLocal : addTxLocal
      );
      then(/^the transaction should (not )?be counted$/, (negated?: string) => {
        expect(isCounted(tx, now)).toBe(!negated);
      });
      and(/^the transaction should (not )?be upcoming$/, (negated?: string) => {
        expect(isUpcoming(tx, now)).toBe(!negated);
      });
    });
  }
});
