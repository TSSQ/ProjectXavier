import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account } from '../../src/domain/types';
import { resolveTransferAccounts, TransferAccounts } from '../../src/domain/assistant';
import { makeAccount } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/transfer-accounts.feature')
);

defineFeature(feature, (test) => {
  let accounts: Account[];
  let result: TransferAccounts;

  beforeEach(() => {
    accounts = [];
  });

  const givenAccounts = (given: any) =>
    given(/^active accounts "(.*)", "(.*)"$/, (a: string, b: string) => {
      accounts = [makeAccount({ name: a }), makeAccount({ name: b })];
    });

  const whenResolve = (when: any) =>
    when(/^I resolve transfer accounts in "(.*)"$/, (text: string) => {
      result = resolveTransferAccounts(text, accounts);
    });

  const thenTo = (then: any) =>
    then(/^the resolved "to" account should be "(.*)"$/, (name: string) => {
      expect(result.to?.name).toBe(name);
    });
  const thenToNone = (then: any) =>
    then(/^the resolved "to" account should be none$/, () => {
      expect(result.to).toBeNull();
    });
  const thenFrom = (and: any) =>
    and(/^the resolved "from" account should be "(.*)"$/, (name: string) => {
      expect(result.from?.name).toBe(name);
    });
  const thenFromNone = (and: any) =>
    and(/^the resolved "from" account should be none$/, () => {
      expect(result.from).toBeNull();
    });

  test('A simple "to <account>" names the destination', ({ given, when, then, and }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
    thenFromNone(and);
  });

  test('"from X to Y" resolves both source and destination', ({ given, when, then, and }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
    thenFrom(and);
  });

  test('No "to" keyword resolves to no destination', ({ given, when, then, and }) => {
    givenAccounts(given);
    whenResolve(when);
    thenToNone(then);
    thenFromNone(and);
  });

  test('Matching is case-insensitive', ({ given, when, then }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  test('A multi-word account name is matched', ({ given, when, then }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  test('A word-boundary mismatch means only the longer name matches at all', ({
    given,
    when,
    then,
  }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  test('The shorter account name still matches on its own', ({ given, when, then }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  test("Trailing punctuation doesn't break the match", ({ given, when, then }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  test('A regex-metacharacter account name still matches literally', ({ given, when, then }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });

  // Both "Invest" and "Invest Co" satisfy the regex against "to Invest Co" —
  // this is what actually exercises the `name.length > best...` tie-break
  // (unlike "Invest"/"Investments", where the word-boundary lookahead means
  // only one candidate ever matches at all).
  test('When both a name and a longer name containing it match, the longer one wins', ({
    given,
    when,
    then,
  }) => {
    givenAccounts(given);
    whenResolve(when);
    thenTo(then);
  });
});
