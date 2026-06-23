import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import {
  accountPeriodBalances,
  netWorthAsOf,
} from '../../src/domain/balances';
import { periodRange, PeriodRange } from '../../src/domain/period';
import { makeAccount, makeTransaction, money, dateToEpoch } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/period-balances.feature')
);

interface TxRow {
  type: string;
  amount: string;
  date: string;
}

defineFeature(feature, (test) => {
  let accounts: Record<string, Account> = {};
  let transactions: Transaction[] = [];
  let range: PeriodRange;

  beforeEach(() => {
    accounts = {};
    transactions = [];
  });

  const addAccount = (name: string, bal: string) => {
    accounts[name] = makeAccount({ name, openingBalance: money(bal) });
  };
  const addTxFor = (name: string, table: TxRow[]) => {
    for (const r of table) {
      transactions.push(
        makeTransaction({
          type: r.type as Transaction['type'],
          amount: money(r.amount),
          accountId: accounts[name]!.id,
          occurredAt: dateToEpoch(r.date),
        })
      );
    }
  };
  const viewMonth = (label: string) => {
    const [y, m] = label.split('-').map(Number);
    range = periodRange(Date.UTC(y!, (m ?? 1) - 1, 1), 'month');
  };
  const forAccount = (name: string) =>
    accountPeriodBalances(Object.values(accounts), transactions, range).find(
      (p) => p.account.id === accounts[name]!.id
    )!;

  test('Closing balance carries forward from the prior period', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, addAccount);
    and(/^the following transactions for "(.*)":$/, addTxFor);
    when(/^I view the month period of "(.*)"$/, viewMonth);
    then(/^the start balance of "(.*)" should be (.*)$/, (name, v) =>
      expect(forAccount(name).start).toBe(money(v))
    );
    and(/^the closing balance of "(.*)" should be (.*)$/, (name, v) =>
      expect(forAccount(name).close).toBe(money(v))
    );
    and(/^the period change of "(.*)" should be (.*)$/, (name, v) =>
      expect(forAccount(name).change).toBe(money(v))
    );
  });

  test('Net worth as of a period end sums all account closing balances', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, addAccount);
    and(/^an account "(.*)" with opening balance (.*)$/, addAccount);
    and(/^the following transactions for "(.*)":$/, addTxFor);
    and(/^the following transactions for "(.*)":$/, addTxFor);
    when(/^I view the month period of "(.*)"$/, viewMonth);
    then(/^the net worth as of the period end should be (.*)$/, (v) =>
      expect(
        netWorthAsOf(Object.values(accounts), transactions, range.end - 1)
      ).toBe(money(v))
    );
  });
});
