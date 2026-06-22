import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import { accountBalance } from '../../src/domain/balances';
import { makeAccount, makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-balances.feature')
);

defineFeature(feature, (test) => {
  let accounts: Record<string, Account> = {};
  let transactions: Transaction[] = [];

  beforeEach(() => {
    accounts = {};
    transactions = [];
  });

  // "asset"/"liability" here are just cosmetic tags — the wording is kept for
  // readability, but a credit card is simply an account with a negative balance.
  const addAsset = (name: string, bal: string) => {
    accounts[name] = makeAccount({
      name,
      tag: 'asset',
      openingBalance: money(bal),
    });
  };
  const addLiability = (name: string, bal: string) => {
    accounts[name] = makeAccount({
      name,
      tag: 'liability',
      openingBalance: money(bal),
    });
  };
  const checkBalance = (name: string, expected: string) => {
    expect(accountBalance(accounts[name]!, transactions)).toBe(money(expected));
  };

  test('An expense reduces an asset account balance', ({ given, when, then }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    when(/^I record an expense of (.*) from "(.*)"$/, (amt, name) => {
      transactions.push(
        makeTransaction({
          type: 'expense',
          amount: money(amt),
          accountId: accounts[name]!.id,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('Income increases an asset account balance', ({ given, when, then }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    when(/^I record income of (.*) into "(.*)"$/, (amt, name) => {
      transactions.push(
        makeTransaction({
          type: 'income',
          amount: money(amt),
          accountId: accounts[name]!.id,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('A transfer moves money between accounts', ({ given, and, when, then }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    when(/^I transfer (.*) from "(.*)" to "(.*)"$/, (amt, from, to) => {
      transactions.push(
        makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accounts[from]!.id,
          transferAccountId: accounts[to]!.id,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
    and(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });

  test('Spending on a credit card increases the amount owed', ({
    given,
    when,
    then,
  }) => {
    given(/^a liability account "(.*)" with opening balance (.*)$/, addLiability);
    when(/^I record an expense of (.*) from "(.*)"$/, (amt, name) => {
      transactions.push(
        makeTransaction({
          type: 'expense',
          amount: money(amt),
          accountId: accounts[name]!.id,
        })
      );
    });
    then(/^the balance of "(.*)" should be (.*)$/, checkBalance);
  });
});
