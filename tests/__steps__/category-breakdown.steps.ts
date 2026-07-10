import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import { PeriodRange, periodRange, categoryBreakdown, CategorySlice } from '../../src/domain/period';
import { makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/category-breakdown.feature')
);

interface Row {
  type: string;
  category: string;
  amount: string;
  pending: string;
}

function monthRange(label: string): PeriodRange {
  const [y, m] = label.split('-').map(Number);
  return periodRange(Date.UTC(y!, (m ?? 1) - 1, 1), 'month');
}

defineFeature(feature, (test) => {
  let transactions: Transaction[] = [];
  let breakdown: CategorySlice[] = [];

  beforeEach(() => {
    transactions = [];
    breakdown = [];
  });

  const loadTable = (table: Row[]) => {
    transactions = table.map((r) =>
      makeTransaction({
        type: r.type as Transaction['type'],
        amount: money(r.amount),
        accountId: 'acc-1',
        occurredAt: Date.UTC(2026, 0, 15),
        categoryId: r.category ? r.category : null,
        pending: r.pending === 'yes',
      })
    );
  };

  const compute = (type: string, label: string) => {
    breakdown = categoryBreakdown(transactions, monthRange(label), type as 'expense' | 'income');
  };

  test('Slices sum by category and sort by amount descending', ({
    given,
    when,
    then,
    and,
  }) => {
    given('the following transactions in "2026-01":', loadTable);
    when(/^I compute the expense category breakdown for "(.*)"$/, (label) =>
      compute('expense', label)
    );
    then(/^the breakdown should have (\d+) slices?$/, (n) =>
      expect(breakdown.length).toBe(Number(n))
    );
    and(/^slice (\d+) should be category "(.*)" with amount (.*)$/, (i, name, amt) => {
      const slice = breakdown[Number(i) - 1]!;
      expect(slice.categoryId).toBe(name);
      expect(slice.amount).toBe(money(amt));
    });
    // This scenario asserts two slices → two `And slice N …` lines in the
    // feature, so jest-cucumber needs a second step def (it matches by
    // position/count, not regex identity).
    and(/^slice (\d+) should be category "(.*)" with amount (.*)$/, (i, name, amt) => {
      const slice = breakdown[Number(i) - 1]!;
      expect(slice.categoryId).toBe(name);
      expect(slice.amount).toBe(money(amt));
    });
  });

  test('Uncategorised transactions collapse into a single slice', ({
    given,
    when,
    then,
    and,
  }) => {
    given('the following transactions in "2026-01":', loadTable);
    when(/^I compute the expense category breakdown for "(.*)"$/, (label) =>
      compute('expense', label)
    );
    then(/^the breakdown should have (\d+) slices?$/, (n) =>
      expect(breakdown.length).toBe(Number(n))
    );
    and(/^slice (\d+) should be uncategorised with amount (.*)$/, (i, amt) => {
      const slice = breakdown[Number(i) - 1]!;
      expect(slice.categoryId).toBeNull();
      expect(slice.amount).toBe(money(amt));
    });
  });

  test('Pending expenses are excluded from the breakdown', ({
    given,
    when,
    then,
    and,
  }) => {
    given('the following transactions in "2026-01":', loadTable);
    when(/^I compute the expense category breakdown for "(.*)"$/, (label) =>
      compute('expense', label)
    );
    then(/^the breakdown should have (\d+) slices?$/, (n) =>
      expect(breakdown.length).toBe(Number(n))
    );
    and(/^slice (\d+) should be category "(.*)" with amount (.*)$/, (i, name, amt) => {
      const slice = breakdown[Number(i) - 1]!;
      expect(slice.categoryId).toBe(name);
      expect(slice.amount).toBe(money(amt));
    });
  });

  test('Transfers never appear in an expense or income breakdown', ({
    given,
    when,
    then,
  }) => {
    given('the following transactions in "2026-01":', loadTable);
    when(/^I compute the expense category breakdown for "(.*)"$/, (label) =>
      compute('expense', label)
    );
    then(/^the breakdown should have (\d+) slices?$/, (n) =>
      expect(breakdown.length).toBe(Number(n))
    );
    when(/^I compute the income category breakdown for "(.*)"$/, (label) =>
      compute('income', label)
    );
    then(/^the breakdown should have (\d+) slices?$/, (n) =>
      expect(breakdown.length).toBe(Number(n))
    );
  });
});
