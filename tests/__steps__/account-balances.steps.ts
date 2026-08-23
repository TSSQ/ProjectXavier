import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import { accountBalance, signedDelta, signedAmountFor } from '../../src/domain/balances';
import { makeAccount, makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-balances.feature')
);

// Comfortably after every transaction date this file's scenarios use
// (makeTransaction defaults occurredAt to 2026-01-01) — these scenarios are
// about the balance math itself, not future-dating, so `now` just needs to
// be "later than everything".
const NOW = Date.UTC(2026, 11, 31);

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
    expect(accountBalance(accounts[name]!, transactions, NOW)).toBe(money(expected));
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
// ── display amount vs balance contribution ───────────────────────────────

  describeDisplayAmount(test);
});

/** What a row SHOWS vs what it contributes to the balance. */
function describeDisplayAmount(test: any) {
  const day = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, dd, 12, 0, 0, 0).getTime();
  };
  let nowMs: number;
  let subject: Transaction;

  const givenToday = (given: any) =>
    given(/^today is "([^"]+)"$/, (d: string) => {
      nowMs = day(d);
    });

  const givenTx = (and: any) =>
    and(
      /^an? (?:(pending) )?(expense|transfer) of ([\d.]+) (?:on "([^"]+)"|from "([^"]+)" to "([^"]+)") dated "([^"]+)"$/,
      (pending: string|undefined, kind: string, amt: string, acct: string|undefined, from: string|undefined, to: string|undefined, d: string) => {
        subject = kind === 'transfer'
          ? makeTransaction({ type:'transfer', amount: money(amt), accountId: from!, transferAccountId: to!, occurredAt: day(d) })
          : makeTransaction({ type:'expense', amount: money(amt), accountId: acct!, occurredAt: day(d), ...(pending ? { pending: true } : {}) });
      }
    );

  const thenDisplay = (then: any) =>
    then(/^its display amount for "([^"]+)" should be (-?\d+)$/, (acct: string, expected: string) => {
      expect(signedAmountFor(subject, acct)).toBe(Number(expected));
    });

  for (const name of [
    'A future-dated expense still displays its real amount',
    'A pending expense still displays its real amount',
    'A counted expense displays and contributes the same',
  ]) {
    test(name, ({ given, and, then }: any) => {
      givenToday(given);
      givenTx(and);
      thenDisplay(then);
      and(/^its balance contribution for "([^"]+)" should be (-?\d+)$/, (acct: string, expected: string) => {
        expect(signedDelta(subject, acct, nowMs)).toBe(Number(expected));
      });
    });
  }

  for (const name of [
    'A future-dated transfer displays negative on the source',
    'A future-dated transfer displays positive on the destination',
    'A self-transfer displays nothing either way',
  ]) {
    test(name, ({ given, and, then }: any) => {
      givenToday(given);
      givenTx(and);
      thenDisplay(then);
    });
  }
}
