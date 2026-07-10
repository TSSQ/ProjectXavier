import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import {
  Granularity,
  PeriodRange,
  periodRange,
  startOfPeriod,
  totalsForRange,
  groupByPeriod,
  cashFlowSeries,
  activePeriods,
  PeriodTotals,
} from '../../src/domain/period';
import { accountBalance } from '../../src/domain/balances';
import { makeAccount, makeTransaction, money, dateToEpoch } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/pending-transactions.feature')
);

interface Row {
  type: string;
  amount: string;
  date: string;
  pending: string;
}

function rangeFor(granularity: Granularity, label: string): PeriodRange {
  let epoch: number;
  if (granularity === 'month') {
    const [y, m] = label.split('-').map(Number);
    epoch = Date.UTC(y!, (m ?? 1) - 1, 1);
  } else {
    epoch = Date.UTC(Number(label), 0, 1);
  }
  return periodRange(epoch, granularity);
}

defineFeature(feature, (test) => {
  let accounts: Record<string, Account> = {};
  let transactions: Transaction[] = [];
  let range: PeriodRange;
  let lastTx: Transaction;
  let buckets: Array<{ start: number; totals: PeriodTotals }>;
  let flow: Array<{ start: number; income: number; expense: number }>;
  let periods: Array<{ start: number }>;

  beforeEach(() => {
    accounts = {};
    transactions = [];
  });

  const addAsset = (name: string, bal: string) => {
    accounts[name] = makeAccount({ name, tag: 'asset', openingBalance: money(bal) });
  };
  const checkBalance = (name: string, expected: string) => {
    expect(accountBalance(accounts[name]!, transactions)).toBe(money(expected));
  };
  const loadTable = (table: Row[]) => {
    transactions = table.map((r) =>
      makeTransaction({
        type: r.type as Transaction['type'],
        amount: money(r.amount),
        accountId: 'acc-1',
        occurredAt: dateToEpoch(r.date),
        pending: r.pending === 'yes',
      })
    );
  };
  const markFirstNotPending = () => {
    transactions[0]!.pending = false;
  };
  /** Parse a "YYYY-MM" label into the epoch ms of that month's start (UTC),
   *  matching startOfPeriod('month') so bucket lookups line up exactly. */
  const monthStart = (label: string): number => {
    const [y, m] = label.split('-').map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, 1);
  };

  test('A pending expense is excluded from the period total', ({
    given,
    when,
    then,
    and,
  }) => {
    given('the following transactions:', loadTable);
    when(/^I view totals for "(.*)" of "(.*)"$/, (granularity, label) => {
      range = rangeFor(granularity as Granularity, label);
    });
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range).expense).toBe(money(v))
    );
    and(/^the income total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range).income).toBe(money(v))
    );
  });

  test('A pending transaction contributes nothing to an account balance', ({
    given,
    and,
    then,
  }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^a pending expense of (.*) from "(.*)"$/, (amt, name) => {
      transactions.push(
        makeTransaction({
          type: 'expense',
          amount: money(amt),
          accountId: accounts[name]!.id,
          pending: true,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('A pending transfer moves nothing between accounts', ({
    given,
    and,
    then,
  }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^a pending transfer of (.*) from "(.*)" to "(.*)"$/, (amt, from, to) => {
      transactions.push(
        makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accounts[from]!.id,
          transferAccountId: accounts[to]!.id,
          pending: true,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
    and(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('Un-pending a transaction makes it re-enter the balance', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^a pending expense of (.*) from "(.*)"$/, (amt, name) => {
      lastTx = makeTransaction({
        type: 'expense',
        amount: money(amt),
        accountId: accounts[name]!.id,
        pending: true,
      });
      transactions.push(lastTx);
    });
    when(/^the transaction is marked not pending$/, () => {
      lastTx.pending = false;
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('A pending expense is excluded from monthly period buckets', ({
    given,
    when,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^I group transactions by "(.*)"$/, (granularity) => {
      buckets = groupByPeriod(transactions, granularity as Granularity);
    });
    then(/^the "(.*)" bucket expense total should be (.*)$/, (label, v) => {
      const bucket = buckets.find((b) => b.start === monthStart(label));
      expect(bucket?.totals.expense).toBe(money(v));
    });
  });

  test('A period containing only a pending transaction does not appear in activePeriods', ({
    given,
    when,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^I list active periods by "(.*)"$/, (granularity) => {
      periods = activePeriods(transactions, granularity as Granularity);
    });
    then(/^there should be (\d+) active periods?$/, (n) => {
      expect(periods.length).toBe(Number(n));
    });
  });

  test('A pending expense is excluded from cash-flow buckets', ({
    given,
    when,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^I compute the cash flow series for "(.*)" by "(.*)"$/, (label, granularity) => {
      flow = cashFlowSeries(
        transactions,
        periodRange(monthStart(label), 'month'),
        granularity as Granularity
      );
    });
    then(/^the "(.*)" cash-flow expense should be (.*)$/, (label, v) => {
      const bucket = flow.find((b) => b.start === startOfPeriod(dateToEpoch(label), 'day'));
      expect(bucket?.expense).toBe(money(v));
    });
  });

  test('Un-pending a transaction makes it re-enter the period total', ({
    given,
    when,
    and,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^the first transaction is marked not pending$/, markFirstNotPending);
    and(/^I view totals for "(.*)" of "(.*)"$/, (granularity, label) => {
      range = rangeFor(granularity as Granularity, label);
    });
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range).expense).toBe(money(v))
    );
  });

  test('Un-pending a transaction makes it re-enter monthly period buckets', ({
    given,
    when,
    and,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^the first transaction is marked not pending$/, markFirstNotPending);
    and(/^I group transactions by "(.*)"$/, (granularity) => {
      buckets = groupByPeriod(transactions, granularity as Granularity);
    });
    then(/^the "(.*)" bucket expense total should be (.*)$/, (label, v) => {
      const bucket = buckets.find((b) => b.start === monthStart(label));
      expect(bucket?.totals.expense).toBe(money(v));
    });
  });

  test('Un-pending a transaction makes it re-enter cash-flow buckets', ({
    given,
    when,
    and,
    then,
  }) => {
    given('the following transactions:', loadTable);
    when(/^the first transaction is marked not pending$/, markFirstNotPending);
    and(/^I compute the cash flow series for "(.*)" by "(.*)"$/, (label, granularity) => {
      flow = cashFlowSeries(
        transactions,
        periodRange(monthStart(label), 'month'),
        granularity as Granularity
      );
    });
    then(/^the "(.*)" cash-flow expense should be (.*)$/, (label, v) => {
      const bucket = flow.find((b) => b.start === startOfPeriod(dateToEpoch(label), 'day'));
      expect(bucket?.expense).toBe(money(v));
    });
  });
});
