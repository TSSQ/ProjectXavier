import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Payee } from '../../src/domain/types';
import {
  findPayeeMatch,
  resolveCategoryId,
  PayeeMatch,
} from '../../src/domain/payees';
import { nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/payee-resolution.feature')
);

defineFeature(feature, (test) => {
  let payees: Payee[] = [];
  let match: PayeeMatch;
  let payee: Payee;
  let resolved: string | null;

  beforeEach(() => {
    payees = [];
  });

  const givenExistingPayees = (given: any) =>
    given(/^existing payees:$/, (table: Array<{ name: string }>) => {
      payees = table.map((r) => ({ id: nextId('payee'), name: r.name }));
    });

  test('An exact name matches an existing payee, ignoring case and spacing', ({
    given,
    when,
    then,
  }) => {
    givenExistingPayees(given);
    when(/^I resolve the payee "(.*)"$/, (name: string) => {
      match = findPayeeMatch(name, payees);
    });
    then(/^it should match the existing payee "(.*)"$/, (name: string) => {
      expect(match.exact?.name).toBe(name);
    });
  });

  test('A close typo is offered as a merge suggestion', ({ given, when, then }) => {
    givenExistingPayees(given);
    when(/^I resolve the payee "(.*)"$/, (name: string) => {
      match = findPayeeMatch(name, payees);
    });
    then(/^it should suggest the existing payee "(.*)"$/, (name: string) => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion?.name).toBe(name);
    });
  });

  test('A clearly different name is treated as new', ({ given, when, then }) => {
    givenExistingPayees(given);
    when(/^I resolve the payee "(.*)"$/, (name: string) => {
      match = findPayeeMatch(name, payees);
    });
    then(/^it should be treated as a new payee$/, () => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion).toBeUndefined();
    });
  });

  const whenResolve = (when: any) =>
    when(/^I resolve the payee "(.*)"$/, (name: string) => {
      match = findPayeeMatch(name, payees);
    });
  const thenSuggests = (then: any) =>
    then(/^it should suggest the existing payee "(.*)"$/, (name: string) => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion?.name).toBe(name);
    });
  const thenNew = (then: any) =>
    then(/^it should be treated as a new payee$/, () => {
      expect(match.exact).toBeUndefined();
      expect(match.suggestion).toBeUndefined();
    });

  test('A name plus noise words suggests the existing payee', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenResolve(when);
    thenSuggests(then);
  });

  test('A name plus noise words beyond typo distance still suggests the existing payee', ({
    given,
    when,
    then,
  }) => {
    givenExistingPayees(given);
    whenResolve(when);
    thenSuggests(then);
  });

  test('A bare name suggests the existing noise-worded payee', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenResolve(when);
    thenSuggests(then);
  });

  test('A short word contained in a longer name is not a variant', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenResolve(when);
    thenNew(then);
  });

  test('A name embedded mid-word is not a variant', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenResolve(when);
    thenNew(then);
  });

  test('Picking a known payee auto-fills its default category', ({
    given,
    when,
    then,
  }) => {
    given(/^a payee "(.*)" whose default category is "(.*)"$/, (name: string, cat: string) => {
      payee = { id: nextId('payee'), name, defaultCategoryId: cat };
    });
    when(/^I resolve the category with no explicit choice$/, () => {
      resolved = resolveCategoryId(null, payee);
    });
    then(/^the resolved category should be "(.*)"$/, (cat: string) => {
      expect(resolved).toBe(cat);
    });
  });

  test('An explicit category overrides the payee default', ({
    given,
    when,
    then,
  }) => {
    given(/^a payee "(.*)" whose default category is "(.*)"$/, (name: string, cat: string) => {
      payee = { id: nextId('payee'), name, defaultCategoryId: cat };
    });
    when(/^I resolve the category with an explicit choice of "(.*)"$/, (cat: string) => {
      resolved = resolveCategoryId(cat, payee);
    });
    then(/^the resolved category should be "(.*)"$/, (cat: string) => {
      expect(resolved).toBe(cat);
    });
  });
});
