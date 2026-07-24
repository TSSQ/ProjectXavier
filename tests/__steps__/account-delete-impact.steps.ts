import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { computeAccountDeleteImpact, AccountDeleteImpact } from '../../src/domain/accountDeleteImpact';
import { Transaction, RecurringSeries } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-delete-impact.feature'));

let nextId = 0;
function makeTx(partial: Partial<Transaction>): Transaction {
  nextId += 1;
  return {
    id: `tx-${nextId}`,
    accountId: 'acc-x',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    occurredAt: 0,
    createdAt: 0,
    source: 'manual',
    pending: false,
    ...partial,
  };
}

function makeSeries(id: string, accountId: string, transferAccountId?: string): RecurringSeries {
  return {
    id,
    rule: { freq: 'monthly', interval: 1, anchor: 0, end: { kind: 'never' } },
    template: {
      accountId,
      type: transferAccountId ? 'transfer' : 'expense',
      amount: 100,
      currency: 'USD',
      transferAccountId: transferAccountId ?? null,
    },
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: 0,
    archived: false,
  };
}

defineFeature(feature, (test) => {
  let transactions: Transaction[];
  let series: RecurringSeries[];
  let impact: AccountDeleteImpact;

  const background = () => {
    transactions = [];
    series = [];
  };

  test('A mix of expenses and transfers on the target account', ({ given, when, then, and }) => {
    given(/^accounts .*$/, background);
    given(/^a \$10 expense on acc-dbs$/, () => {
      transactions.push(makeTx({ accountId: 'acc-dbs', type: 'expense', amount: 1000 }));
    });
    and(/^a \$500 transfer from acc-dbs to acc-ocbc$/, () => {
      transactions.push(
        makeTx({ accountId: 'acc-dbs', type: 'transfer', transferAccountId: 'acc-ocbc', amount: 50000 })
      );
    });
    and(/^a \$200 transfer from acc-ocbc to acc-dbs$/, () => {
      transactions.push(
        makeTx({ accountId: 'acc-ocbc', type: 'transfer', transferAccountId: 'acc-dbs', amount: 20000 })
      );
    });
    and(/^a \$5 expense on acc-cash$/, () => {
      transactions.push(makeTx({ accountId: 'acc-cash', type: 'expense', amount: 500 }));
    });
    when(/^I compute the delete impact for acc-dbs$/, () => {
      impact = computeAccountDeleteImpact('acc-dbs', transactions, series);
    });
    then(/^the transaction count should be (\d+)$/, (n: string) => {
      expect(impact.transactionCount).toBe(Number(n));
    });
    and(/^the transfer count should be (\d+)$/, (n: string) => {
      expect(impact.transferCount).toBe(Number(n));
    });
    and(/^the counterparty accounts should be acc-ocbc$/, () => {
      expect(impact.counterpartyAccountIds).toEqual(['acc-ocbc']);
    });
  });

  test('No transactions touch the account at all', ({ given, when, then, and }) => {
    given(/^accounts .*$/, background);
    given(/^a \$5 expense on acc-cash$/, () => {
      transactions.push(makeTx({ accountId: 'acc-cash', type: 'expense', amount: 500 }));
    });
    when(/^I compute the delete impact for acc-dbs$/, () => {
      impact = computeAccountDeleteImpact('acc-dbs', transactions, series);
    });
    then(/^the transaction count should be (\d+)$/, (n: string) => {
      expect(impact.transactionCount).toBe(Number(n));
    });
    and(/^the transfer count should be (\d+)$/, (n: string) => {
      expect(impact.transferCount).toBe(Number(n));
    });
    and(/^the counterparty accounts should be none$/, () => {
      expect(impact.counterpartyAccountIds).toEqual([]);
    });
  });

  test('A recurring series referencing the account as its own account or transfer destination', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^accounts .*$/, background);
    given(/^a recurring series "rent" with account acc-dbs$/, () => {
      series.push(makeSeries('rent', 'acc-dbs'));
    });
    and(/^a recurring series "savings-transfer" transferring into acc-dbs from acc-cash$/, () => {
      series.push(makeSeries('savings-transfer', 'acc-cash', 'acc-dbs'));
    });
    and(/^a recurring series "unrelated" with account acc-cash$/, () => {
      series.push(makeSeries('unrelated', 'acc-cash'));
    });
    when(/^I compute the delete impact for acc-dbs$/, () => {
      impact = computeAccountDeleteImpact('acc-dbs', transactions, series);
    });
    then(/^the recurring series ids should include "(.*)" and "(.*)"$/, (a: string, b: string) => {
      expect(impact.recurringSeriesIds).toEqual(expect.arrayContaining([a, b]));
    });
    and(/^the recurring series ids should not include "(.*)"$/, (id: string) => {
      expect(impact.recurringSeriesIds).not.toEqual(expect.arrayContaining([id]));
    });
  });
});
