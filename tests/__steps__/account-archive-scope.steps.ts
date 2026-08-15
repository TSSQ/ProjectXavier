import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import { accountsInScope, isTransactionVisible } from '../../src/domain/accountArchive';
import { makeAccount, makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-archive-scope.feature')
);

defineFeature(feature, (test) => {
  let accounts: Account[];

  beforeEach(() => {
    accounts = [];
  });

  // Same convention as account-archive.steps.ts: shared push helpers reused
  // by name across scenarios.
  const pushAccount = (name: string) => {
    accounts.push(makeAccount({ name }));
  };
  const pushArchivedAccount = (name: string) => {
    accounts.push(makeAccount({ name, archived: true }));
  };

  // ── accountsInScope ─────────────────────────────────────────────────────
  test('With the toggle off, only active accounts are in scope', ({
    given,
    and,
    when,
    then,
  }) => {
    let result: Account[];
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    when(/^I compute accounts in scope with includeArchived (true|false)$/, (flag: string) => {
      result = accountsInScope(accounts, flag === 'true');
    });
    then(/^the in-scope names should be "(.*)"$/, (names: string) => {
      expect(result.map((a) => a.name)).toEqual(names.split(', '));
    });
  });

  test('With the toggle on, every account is in scope, preserving order', ({
    given,
    and,
    when,
    then,
  }) => {
    let result: Account[];
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I compute accounts in scope with includeArchived (true|false)$/, (flag: string) => {
      result = accountsInScope(accounts, flag === 'true');
    });
    then(/^the in-scope names should be "(.*)"$/, (names: string) => {
      expect(result.map((a) => a.name)).toEqual(names.split(', '));
    });
  });

  test('With no archived accounts, the toggle changes nothing', ({
    given,
    and,
    when,
    then,
  }) => {
    let result: Account[];
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I compute accounts in scope with includeArchived (true|false)$/, (flag: string) => {
      result = accountsInScope(accounts, flag === 'true');
    });
    then(/^the in-scope names should be "(.*)"$/, (names: string) => {
      expect(result.map((a) => a.name)).toEqual(names.split(', '));
    });
  });

  // ── isTransactionVisible ────────────────────────────────────────────────
  test('A transaction is visible when its account is in the visible set', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(/^an expense transaction on account "(.*)"$/, (accountId: string) => {
      tx = makeTransaction({ type: 'expense', amount: money('10'), accountId });
    });
    then(/^the transaction should be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(true);
    });
  });

  test('A transaction is hidden when its account is not in the visible set', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(/^an expense transaction on account "(.*)"$/, (accountId: string) => {
      tx = makeTransaction({ type: 'expense', amount: money('10'), accountId });
    });
    then(/^the transaction should not be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(false);
    });
  });

  test('A transfer stays visible from its "from" leg even when the "to" leg is archived (§8.2)', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(
      /^a transfer transaction from account "(.*)" to account "(.*)"$/,
      (accountId: string, transferAccountId: string) => {
        tx = makeTransaction({
          type: 'transfer',
          amount: money('10'),
          accountId,
          transferAccountId,
        });
      }
    );
    then(/^the transaction should be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(true);
    });
  });

  test('A transfer stays visible from its "to" leg even when the "from" leg is archived (§8.2)', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(
      /^a transfer transaction from account "(.*)" to account "(.*)"$/,
      (accountId: string, transferAccountId: string) => {
        tx = makeTransaction({
          type: 'transfer',
          amount: money('10'),
          accountId,
          transferAccountId,
        });
      }
    );
    then(/^the transaction should be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(true);
    });
  });

  test('A transfer is hidden when neither leg is in the visible set', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(
      /^a transfer transaction from account "(.*)" to account "(.*)"$/,
      (accountId: string, transferAccountId: string) => {
        tx = makeTransaction({
          type: 'transfer',
          amount: money('10'),
          accountId,
          transferAccountId,
        });
      }
    );
    then(/^the transaction should not be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(false);
    });
  });

  test('A transfer between two archived legs becomes visible once both are in scope', ({
    given,
    and,
    then,
  }) => {
    let visibleIds: Set<string>;
    let tx: Transaction;
    given(/^the visible account ids "(.*)"$/, (ids: string) => {
      visibleIds = new Set(ids.split(','));
    });
    and(
      /^a transfer transaction from account "(.*)" to account "(.*)"$/,
      (accountId: string, transferAccountId: string) => {
        tx = makeTransaction({
          type: 'transfer',
          amount: money('10'),
          accountId,
          transferAccountId,
        });
      }
    );
    then(/^the transaction should be visible$/, () => {
      expect(isTransactionVisible(tx, visibleIds)).toBe(true);
    });
  });
});
