import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction, Account } from '../../src/domain/types';
import {
  summarizeTransactionSelection,
  TransactionSelectionSummary,
} from '../../src/domain/transactionCandidates';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/transaction-batch-delete.feature')
);

const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime();

const ACCOUNTS: Account[] = [
  { id: 'acc-wallet', name: 'Wallet', currency: 'USD', openingBalance: 0, archived: false },
  { id: 'acc-savings', name: 'Savings', currency: 'USD', openingBalance: 0, archived: false },
  { id: 'acc-investment', name: 'Investment', currency: 'USD', openingBalance: 0, archived: false },
];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `t${idCounter}`;
}

function baseTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId(),
    accountId: 'acc-wallet',
    type: 'expense',
    amount: 1000,
    currency: 'USD',
    categoryId: null,
    payeeId: null,
    transferAccountId: null,
    note: null,
    occurredAt: NOW,
    createdAt: NOW,
    source: 'manual',
    receiptRef: null,
    sourceText: null,
    seriesId: null,
    occurrenceDate: null,
    pending: false,
    ...overrides,
  };
}

function transferTx(fromName: string, toId: string | null, amount = 2000): Transaction {
  const fromId = ACCOUNTS.find((a) => a.name === fromName)?.id ?? 'acc-wallet';
  return baseTx({ accountId: fromId, type: 'transfer', amount, transferAccountId: toId });
}

defineFeature(feature, (test) => {
  test('An empty selection summarises to zero, with nothing to disclose', ({ when, then, and }) => {
    let summary: TransactionSelectionSummary;

    when(/^I summarise an empty selection$/, () => {
      summary = summarizeTransactionSelection([], ACCOUNTS);
    });
    then(/^the selection count should be (\d+)$/, (n: string) => {
      expect(summary.count).toBe(Number(n));
    });
    and(/^the selection total should be (\d+) minor units$/, (n: string) => {
      expect(summary.totalAmountMinor).toBe(Number(n));
    });
    and(/^the selection should disclose no transfer counterparties$/, () => {
      expect(summary.transferCounterpartyNames).toEqual([]);
    });
  });

  test("The total is the sum of each row's positive amount, not a signed net", ({
    given,
    when,
    then,
    and,
  }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(/^a selection of an expense of (\d+), an income of (\d+), and a transfer of (\d+)$/, (
      expense: string,
      income: string,
      transfer: string
    ) => {
      selected = [
        baseTx({ type: 'expense', amount: Number(expense) }),
        baseTx({ type: 'income', amount: Number(income) }),
        transferTx('Wallet', 'acc-savings', Number(transfer)),
      ];
    });
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection count should be (\d+)$/, (n: string) => {
      expect(summary.count).toBe(Number(n));
    });
    and(/^the selection total should be (\d+) minor units$/, (n: string) => {
      expect(summary.totalAmountMinor).toBe(Number(n));
    });
  });

  test('A selection with no transfers discloses no counterparties', ({ given, when, then }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(/^a selection of an expense of (\d+) and an income of (\d+)$/, (
      expense: string,
      income: string
    ) => {
      selected = [
        baseTx({ type: 'expense', amount: Number(expense) }),
        baseTx({ type: 'income', amount: Number(income) }),
      ];
    });
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection should disclose no transfer counterparties$/, () => {
      expect(summary.transferCounterpartyNames).toEqual([]);
    });
  });

  test('A selection with one transfer names its counterparty account', ({ given, when, then }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(/^a selection containing a transfer from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      const toId = ACCOUNTS.find((a) => a.name === to)?.id ?? null;
      selected = [transferTx(from, toId)];
    });
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection should disclose the transfer counterparties "(.*)"$/, (names: string) => {
      expect(summary.transferCounterpartyNames).toEqual(names.split(', '));
    });
  });

  test('A selection with transfers to two different accounts names both, sorted', ({
    given,
    when,
    then,
  }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(
      /^a selection containing a transfer from "(.*)" to "(.*)" and a transfer from "(.*)" to "(.*)"$/,
      (from1: string, to1: string, from2: string, to2: string) => {
        const toId1 = ACCOUNTS.find((a) => a.name === to1)?.id ?? null;
        const toId2 = ACCOUNTS.find((a) => a.name === to2)?.id ?? null;
        selected = [transferTx(from1, toId1), transferTx(from2, toId2)];
      }
    );
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection should disclose the transfer counterparties "(.*)"$/, (names: string) => {
      expect(summary.transferCounterpartyNames).toEqual(names.split(', '));
    });
  });

  test('Two transfers to the SAME counterparty account are deduplicated to one name', ({
    given,
    when,
    then,
  }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(/^a selection containing two transfers from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      const toId = ACCOUNTS.find((a) => a.name === to)?.id ?? null;
      selected = [transferTx(from, toId), transferTx(from, toId)];
    });
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection should disclose the transfer counterparties "(.*)"$/, (names: string) => {
      expect(summary.transferCounterpartyNames).toEqual(names.split(', '));
    });
  });

  test("A transfer's counterparty id that no longer resolves to a real account falls back to a generic name", ({
    given,
    when,
    then,
  }) => {
    let selected: Transaction[] = [];
    let summary: TransactionSelectionSummary;

    given(/^a selection containing a transfer to an account id that no longer exists$/, () => {
      selected = [transferTx('Wallet', 'acc-deleted-long-ago')];
    });
    when(/^I summarise the selection$/, () => {
      summary = summarizeTransactionSelection(selected, ACCOUNTS);
    });
    then(/^the selection should disclose the transfer counterparties "(.*)"$/, (names: string) => {
      expect(summary.transferCounterpartyNames).toEqual(names.split(', '));
    });
  });

  test('The summary is deterministic — identical input, identical output across 50 iterations', ({
    given,
    when,
    then,
  }) => {
    let selected: Transaction[] = [];
    let summaries: TransactionSelectionSummary[] = [];

    given(
      /^a selection containing a transfer from "(.*)" to "(.*)" and a transfer from "(.*)" to "(.*)"$/,
      (from1: string, to1: string, from2: string, to2: string) => {
        const toId1 = ACCOUNTS.find((a) => a.name === to1)?.id ?? null;
        const toId2 = ACCOUNTS.find((a) => a.name === to2)?.id ?? null;
        selected = [transferTx(from1, toId1), transferTx(from2, toId2)];
      }
    );
    when(/^I summarise the same selection (\d+) times$/, (n: string) => {
      summaries = Array.from({ length: Number(n) }, () =>
        summarizeTransactionSelection(selected, ACCOUNTS)
      );
    });
    then(/^every one of the 50 summaries should be identical$/, () => {
      for (const s of summaries) expect(s).toEqual(summaries[0]);
    });
  });
});
