import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import { BudgetSuggestion, suggestBudgets } from '../../src/domain/budgets';
import { FIXTURE_CATEGORIES, NOW, expenseTx, local } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-suggestions.feature'));

defineFeature(feature, (test) => {
  let transactions: Transaction[] = [];
  let suggestions: BudgetSuggestion[] = [];
  beforeEach(() => {
    transactions = [];
    suggestions = [];
  });

  const spend = (categoryId: string, major: number, month: number, day = 10) =>
    transactions.push(expenseTx(categoryId, major, local(2026, month, day)));
  const ask = () => {
    suggestions = suggestBudgets(
      { transactions, categories: FIXTURE_CATEGORIES, now: NOW, month: '2026-10' },
      'USD'
    );
  };
  const find = (id: string) => suggestions.find((s) => s.categoryId === id);
  const spreadOverThreeMonths = (id: string, total: number) => {
    spend(id, total, 7);
  };

  test('The average rounds to the nearest ten, half up', ({ given, when, then }) => {
    given(
      'Dining spend of these amounts in July, August and September:',
      (rows: Array<Record<string, string>>) => {
        const amounts = Object.values(rows[0]!).map(Number);
        [7, 8, 9].forEach((m, i) => spend('dining', amounts[i]!, m));
      }
    );
    when(/^I ask for suggestions for October$/, ask);
    then(/^Dining should be suggested at (\d+)$/, (major: string) => {
      expect(find('dining')?.amount).toBe(Number(major) * 100);
    });
  });

  test('Rounding at the edges', ({ given, when, then }) => {
    given(/^Dining spend totalling (\d+) over the three months before October$/, (total: string) =>
      spreadOverThreeMonths('dining', Number(total))
    );
    when(/^I ask for suggestions for October$/, ask);
    then(/^Dining should be suggested at (\d+)$/, (major: string) => {
      expect(find('dining')?.amount).toBe(Number(major) * 100);
    });
  });

  test('Averages of 50 or more start ticked and the rest start unticked', ({ given, and, when, then }) => {
    given(/^Dining spend totalling (\d+) over the three months before October$/, (t: string) =>
      spreadOverThreeMonths('dining', Number(t))
    );
    and(/^Gifts spend totalling (\d+) over the three months before October$/, (t: string) =>
      spreadOverThreeMonths('gifts', Number(t))
    );
    when(/^I ask for suggestions for October$/, ask);
    then(/^Dining should be suggested at (\d+) and ticked$/, (major: string) => {
      expect(find('dining')).toMatchObject({ amount: Number(major) * 100, ticked: true });
    });
    and(/^Gifts should be suggested at (\d+) and unticked$/, (major: string) => {
      expect(find('gifts')).toMatchObject({ amount: Number(major) * 100, ticked: false });
    });
    and('Dining should be listed before Gifts', () => {
      const ids = suggestions.map((s) => s.categoryId);
      expect(ids.indexOf('dining')).toBeLessThan(ids.indexOf('gifts'));
    });
  });

  test('No spend in the three months means no suggestions', ({ given, when, then }) => {
    given('no spend in the three months before October', () => undefined);
    when(/^I ask for suggestions for October$/, ask);
    then('there should be no suggestions', () => {
      expect(suggestions).toEqual([]);
    });
  });

  test('Only counted spend and full calendar months are averaged', ({ given, when, then }) => {
    given('Dining spend of 300 in October itself and 30 pending in September', () => {
      spend('dining', 300, 10, 5);
      transactions.push(expenseTx('dining', 30, local(2026, 9, 5), { pending: true }));
    });
    when(/^I ask for suggestions for October$/, ask);
    then('there should be no suggestions', () => {
      expect(suggestions).toEqual([]);
    });
  });
});
