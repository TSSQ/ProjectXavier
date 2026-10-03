import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { BudgetSummary, budgetCardKind, computeBudgets } from '../../src/domain/budgets';
import {
  FIXTURE_BUDGETS,
  FIXTURE_CATEGORIES,
  NOW,
  mockupFixture,
  twoAccountFixture,
  Fixture,
} from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-dashboard.feature'));

const summaryOf = (f: Fixture, rows = FIXTURE_BUDGETS, month = '2026-10'): BudgetSummary =>
  computeBudgets({
    transactions: f.transactions,
    series: f.series,
    categories: FIXTURE_CATEGORIES,
    rows,
    now: NOW,
    month,
  });

defineFeature(feature, (test) => {
  test('Visibility by period', ({ given, when, then }) => {
    let fixture: Fixture;
    let kind: string;
    given('the mockup fixture on October 18', () => {
      fixture = mockupFixture();
    });
    when(/^the period is (\w+) and I compute October$/, (mode: string) => {
      kind = budgetCardKind(mode as 'month' | 'year' | 'date', summaryOf(fixture));
    });
    then(/^the dashboard budget card should be (\w+)$/, (shown: string) => {
      expect(kind).toBe(shown);
    });
  });

  test('With no budgets the current month offers setup and another month shows nothing', ({
    given,
    then,
    and,
  }) => {
    let fixture: Fixture;
    given('a ledger with no budgets on October 18', () => {
      fixture = mockupFixture();
    });
    then(/^the card for the current month should be "(.*)"$/, (kind: string) => {
      expect(budgetCardKind('month', summaryOf(fixture, [], '2026-10'))).toBe(kind);
    });
    and(/^the card for a past month should be "(.*)"$/, (kind: string) => {
      expect(budgetCardKind('month', summaryOf(fixture, [], '2026-09'))).toBe(kind);
    });
  });

  test('An account filter changes neither the card nor its numbers', ({ given, when, and, then }) => {
    let fixture: Fixture;
    let whole: BudgetSummary;
    let filtered: BudgetSummary;
    given('the mockup fixture on October 18 spread over two accounts', () => {
      fixture = twoAccountFixture();
    });
    when('I compute the budgets for the whole ledger', () => {
      whole = summaryOf(fixture);
    });
    and('I compute the budgets for a ledger an account filter would show', () => {
      // The dashboard hands the budget math the FULL ledger whatever the
      // filter says; this is that call, made twice.
      filtered = summaryOf({ transactions: [...fixture.transactions], series: fixture.series });
    });
    then('both summaries should be identical', () => {
      expect(filtered).toEqual(whole);
      expect(whole.spent).toBe(128700);
    });
    and('the card kind should be the same for both', () => {
      expect(budgetCardKind('month', filtered)).toBe(budgetCardKind('month', whole));
    });
  });
});
