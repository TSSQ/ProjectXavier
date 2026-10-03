import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, Transaction, RecurringSeries } from '../../src/domain/types';
import {
  SetBudgetIntent,
  detectBudgetIntent,
  resolveBudgetCategory,
} from '../../src/domain/budgetIntent';
import { computeBudgets } from '../../src/domain/budgets';
import { savedChip, setBudgetConfirmText, titleCase } from '../../src/domain/budgetCopy';
import {
  FIXTURE_BUDGETS,
  FIXTURE_CATEGORIES,
  NOW,
  cat,
  expenseTx,
  local,
  mockupFixture,
} from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-intent.feature'));

defineFeature(feature, (test) => {
  let transactions: Transaction[] = [];
  let series: RecurringSeries[] = [];
  let categories: Category[] = [];

  beforeEach(() => {
    transactions = [];
    series = [];
    categories = [];
  });

  const givenCategories = () => {
    categories = [cat('groceries', 'Groceries', '🛒'), cat('dining', 'Dining', '🍔')];
  };

  test('Set-budget statements route', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        const intent = detectBudgetIntent(text, categories);
        expect(intent?.kind).toBe('set-budget');
        expect((intent as SetBudgetIntent).categoryName).toBe(category);
        expect((intent as SetBudgetIntent).amount).toBe(Number(amount));
      }
    );
  });

  test('An explicit set-budget for an unknown category still routes', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        const intent = detectBudgetIntent(text, categories);
        expect(intent).toMatchObject({ kind: 'set-budget', categoryName: category, amount: Number(amount) });
      }
    );
  });

  test('Spends and other budget talk fall through', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(/^"(.*)" should not route to a budget answer$/, (text: string) => {
      expect(detectBudgetIntent(text, categories)).toBeNull();
    });
  });

  test('The category resolves exactly, by suggestion, or not at all', ({ given, then }) => {
    given('the categories Groceries and Dining', () => {
      categories = [cat('groceries', 'Groceries', '🛒'), cat('dining', 'Dining', '🍔')];
    });
    then(/^"(.*)" should resolve as (\w+)$/, (typed: string, kind: string) => {
      expect(resolveBudgetCategory(typed, categories).kind).toBe(kind);
    });
  });

  test('The confirm copy', ({ then, and }) => {
    then(/^changing Groceries from 400 to 450 should read "(.*)"$/, (text: string) => {
      expect(
        setBudgetConfirmText({ categoryName: 'Groceries', current: 40000, next: 45000, month: '2026-10', currency: 'USD' })
      ).toBe(text);
    });
    and(/^setting a first Groceries budget of 450 should read "(.*)"$/, (text: string) => {
      expect(
        setBudgetConfirmText({ categoryName: 'Groceries', current: null, next: 45000, month: '2026-10', currency: 'USD' })
      ).toBe(text);
    });
    and(/^a missing category should read "(.*)"$/, (text: string) => {
      expect(`I couldn't find a ${titleCase('dining')} category.`).toBe(text);
    });
  });

  const chipFor = (name: string, month: string) => {
    const summary = computeBudgets({
      transactions,
      series,
      categories: FIXTURE_CATEGORIES,
      rows: FIXTURE_BUDGETS,
      now: NOW,
      month,
    });
    const category = FIXTURE_CATEGORIES.find((c) => c.name === name)!;
    const view = summary.categories.find((v) => v.categoryId === category.id)!;
    return savedChip({
      icon: category.icon!,
      name,
      view,
      txMonth: month,
      now: NOW,
      currency: 'USD',
    });
  };
  const givenMockup = () => {
    const f = mockupFixture();
    transactions = f.transactions;
    series = f.series;
  };

  test("The saved-expense chip follows the category's state", ({ given, and, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    and(/^a Dining expense of ([\d.]+) on October 18$/, (major: string) => {
      transactions.push(expenseTx('dining', Number(major), local(2026, 10, 18, 9)));
    });
    then(/^the chip for Dining should read "(.*)" as (\w+)$/, (label: string, state: string) => {
      expect(chipFor('Dining', '2026-10')).toEqual({ label, state });
    });
    and(/^the chip for Entertainment should read "(.*)" as (\w+)$/, (label: string, state: string) => {
      expect(chipFor('Entertainment', '2026-10')).toEqual({ label, state });
    });
  });

  test('The saved-expense chip for another month names it', ({ given, and, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    and(/^a Dining expense of (\d+) on September 5$/, (major: string) => {
      transactions.push(expenseTx('dining', Number(major), local(2026, 9, 5)));
    });
    then(/^the chip for Dining in September should read "(.*)"$/, (label: string) => {
      expect(chipFor('Dining', '2026-09').label).toBe(label);
    });
  });
});
