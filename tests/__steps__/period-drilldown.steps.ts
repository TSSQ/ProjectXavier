import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import {
  Granularity,
  PeriodRange,
  periodRange,
  totalsForRange,
} from '../../src/domain/period';
import { makeTransaction, money, dateToEpoch } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/period-drilldown.feature')
);

interface Row {
  type: string;
  amount: string;
  date: string;
}

function rangeFor(granularity: Granularity, label: string): PeriodRange {
  let epoch: number;
  if (granularity === 'day') {
    epoch = dateToEpoch(label);
  } else if (granularity === 'month') {
    const [y, m] = label.split('-').map(Number);
    epoch = Date.UTC(y!, (m ?? 1) - 1, 1);
  } else {
    epoch = Date.UTC(Number(label), 0, 1);
  }
  return periodRange(epoch, granularity);
}

// Comfortably after every date the Background table uses (up to 2026-02-03)
// — this feature is about period drill-down math, not future-dating.
const NOW = Date.UTC(2026, 11, 31);

defineFeature(feature, (test) => {
  let transactions: Transaction[] = [];
  let range: PeriodRange;

  beforeEach(() => {
    transactions = [];
  });

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

  const viewTotals = (granularity: string, label: string) => {
    range = rangeFor(granularity as Granularity, label);
  };

  test('Monthly expense total', ({ given, when, then, and }) => {
    given('the following transactions:', loadTable);
    when(/^I view totals for "(.*)" of "(.*)"$/, viewTotals);
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, NOW).expense).toBe(money(v))
    );
    and(/^the income total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, NOW).income).toBe(money(v))
    );
    and(/^the net total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, NOW).net).toBe(money(v))
    );
  });

  test('Daily drill-down', ({ given, when, then }) => {
    given('the following transactions:', loadTable);
    when(/^I view totals for "(.*)" of "(.*)"$/, viewTotals);
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, NOW).expense).toBe(money(v))
    );
  });

  test('Yearly total', ({ given, when, then }) => {
    given('the following transactions:', loadTable);
    when(/^I view totals for "(.*)" of "(.*)"$/, viewTotals);
    then(/^the expense total should be (.*)$/, (v) =>
      expect(totalsForRange(transactions, range, NOW).expense).toBe(money(v))
    );
  });
});
