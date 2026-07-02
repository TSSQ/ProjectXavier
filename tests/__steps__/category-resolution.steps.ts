import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, TransactionType } from '../../src/domain/types';
import { findCategoryMatch, CategoryMatch } from '../../src/domain/categories';
import { nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/category-resolution.feature')
);

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let match: CategoryMatch;

  beforeEach(() => {
    categories = [];
  });

  const givenExistingCategories = (given: any) =>
    given(/^existing categories:$/, (table: Array<{ name: string; kind: string }>) => {
      categories = table.map((r) => ({
        id: nextId('cat'),
        name: r.name,
        kind: r.kind as TransactionType,
      }));
    });

  test('An exact name matches an existing category of the same kind, ignoring case and spacing', ({
    given,
    when,
    then,
  }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should match the existing category "(.*)"$/, (name: string) => {
      expect(match.exact?.name).toBe(name);
    });
  });

  test('A close typo is offered as a merge suggestion', ({ given, when, then }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should suggest the existing category "(.*)"$/, (name: string) => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion?.name).toBe(name);
    });
  });

  test('A clearly different name is treated as new', ({ given, when, then }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should be treated as a new category$/, () => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion).toBeUndefined();
    });
  });

  test('A name that exists only under a different kind is treated as new', ({
    given,
    when,
    then,
  }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should be treated as a new category$/, () => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion).toBeUndefined();
    });
  });

  test('An empty name is treated as new', ({ given, when, then }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should be treated as a new category$/, () => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion).toBeUndefined();
    });
  });

  test('An exact match takes precedence over a fuzzy candidate', ({ given, when, then }) => {
    givenExistingCategories(given);
    when(/^I resolve the expense category "(.*)"$/, (name: string) => {
      match = findCategoryMatch(name, 'expense', categories);
    });
    then(/^it should match the existing category "(.*)"$/, (name: string) => {
      expect(match.exact?.name).toBe(name);
    });
  });
});
