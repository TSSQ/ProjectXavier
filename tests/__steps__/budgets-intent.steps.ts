import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category } from '../../src/domain/types';
import {
  SetBudgetIntent,
  detectBudgetIntent,
  resolveBudgetCategory,
} from '../../src/domain/budgetIntent';
import { setBudgetConfirmText, titleCase } from '../../src/domain/budgetCopy';
import { cat } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-intent.feature'));

defineFeature(feature, (test) => {
  let categories: Category[] = [];

  beforeEach(() => {
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

  test('"budget <amount> <preposition> <words>" is a command even for an unknown category', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        expect(detectBudgetIntent(text, categories)).toMatchObject({
          kind: 'set-budget',
          categoryName: category,
          amount: Number(amount),
        });
      }
    );
  });

  test('A bare "budget <amount> <category>" for an existing category is a set-budget', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        expect(detectBudgetIntent(text, categories)).toMatchObject({
          kind: 'set-budget',
          categoryName: category,
          amount: Number(amount),
        });
      }
    );
  });

  test('An existing category with a connector in its name still wins', ({ given, then }) => {
    given('the categories Groceries, Dining and Food and Drink', () => {
      categories = [cat('groceries', 'Groceries', '🛒'), cat('dining', 'Dining', '🍔'), cat('fd', 'Food and Drink', '🍽️')];
    });
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        expect(detectBudgetIntent(text, categories)).toMatchObject({
          kind: 'set-budget',
          categoryName: category,
          amount: Number(amount),
        });
      }
    );
  });

  test('A monthly marker makes the bare form a set-budget, even for an unknown category', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        expect(detectBudgetIntent(text, categories)).toMatchObject({
          kind: 'set-budget',
          categoryName: category,
          amount: Number(amount),
        });
      }
    );
  });

  test('A bare "budget <amount> <words>" for a name that is no category asks which it is', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(
      /^"(.*)" should ask budget or spend for "(.*)" at (\d+)$/,
      (text: string, words: string, amount: string) => {
        expect(detectBudgetIntent(text, categories)).toEqual({
          kind: 'budget-or-spend',
          categoryName: words,
          amount: Number(amount),
        });
      }
    );
  });

  test('A phrase with a preposition after the amount is a spend, not a question', ({ given, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    then(/^"(.*)" should not route to a budget answer$/, (text: string) => {
      expect(detectBudgetIntent(text, categories)).toBeNull();
    });
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
});
