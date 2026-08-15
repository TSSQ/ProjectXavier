import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, RecurringSeries, Transaction } from '../../src/domain/types';
import {
  matchesAccountQuery,
  splitAccountsForManage,
  hasArchivedAccounts,
  archiveActionFor,
  collidesWithActiveName,
  recommendArchiveOverDelete,
} from '../../src/domain/accountArchive';
import { computeAccountDeleteImpact, AccountDeleteImpact } from '../../src/domain/accountDeleteImpact';
import { makeAccount, makeTransaction, money } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-archive.feature'));

defineFeature(feature, (test) => {
  let accounts: Account[];
  let transactions: Transaction[];
  let series: RecurringSeries[];

  beforeEach(() => {
    accounts = [];
    transactions = [];
    series = [];
  });

  // Shared account-building steps, reused by name across scenarios (same
  // convention as net-worth.steps.ts's add/addTagged/addArchived).
  const pushAccount = (name: string) => {
    accounts.push(makeAccount({ name }));
  };
  const pushArchivedAccount = (name: string) => {
    accounts.push(makeAccount({ name, archived: true }));
  };
  const pushTaggedAccount = (name: string, tag: string) => {
    accounts.push(makeAccount({ name, tag }));
  };
  const pushSubtypeAccount = (name: string, subtype: string) => {
    // makeAccount() doesn't pass `subtype` through (it isn't spread from
    // `partial`), so set it directly on the built account instead.
    accounts.push({ ...makeAccount({ name }), subtype });
  };
  const pushAccountWithUndefinedArchived = (name: string) => {
    const account = makeAccount({ name });
    delete account.archived; // simulate a record where the optional field was never set
    accounts.push(account);
  };

  // ── matchesAccountQuery ───────────────────────────────────────────────────
  test('An empty query matches every account', ({ given, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    then(/^it should match the query "(.*)"$/, (query: string) => {
      expect(matchesAccountQuery(accounts[0]!, query)).toBe(true);
    });
  });

  test('A query matches by name, case-insensitively', ({ given, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    then(/^it should match the query "(.*)"$/, (query: string) => {
      expect(matchesAccountQuery(accounts[0]!, query)).toBe(true);
    });
  });

  test('A query matches by tag, case-insensitively', ({ given, then }) => {
    given(/^an account "(.*)" tagged "(.*)"$/, pushTaggedAccount);
    then(/^it should match the query "(.*)"$/, (query: string) => {
      expect(matchesAccountQuery(accounts[0]!, query)).toBe(true);
    });
  });

  test('A query matches by subtype, case-insensitively', ({ given, then }) => {
    given(/^an account "(.*)" with subtype "(.*)"$/, pushSubtypeAccount);
    then(/^it should match the query "(.*)"$/, (query: string) => {
      expect(matchesAccountQuery(accounts[0]!, query)).toBe(true);
    });
  });

  test('A query that matches nothing does not match', ({ given, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    then(/^it should not match the query "(.*)"$/, (query: string) => {
      expect(matchesAccountQuery(accounts[0]!, query)).toBe(false);
    });
  });

  // ── splitAccountsForManage ────────────────────────────────────────────────
  test('Partitions active and archived accounts, preserving input order', ({
    given,
    and,
    when,
    then,
  }) => {
    let result: { active: Account[]; archived: Account[] };
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    when(/^I split the accounts for manage with query "(.*)"$/, (query: string) => {
      result = splitAccountsForManage(accounts, query);
    });
    then(/^the active names should be "(.*)"$/, (names: string) => {
      expect(result.active.map((a) => a.name)).toEqual(names.split(', '));
    });
    and(/^the archived names should be "(.*)"$/, (names: string) => {
      expect(result.archived.map((a) => a.name)).toEqual(names.split(', '));
    });
  });

  test('The same query filters both the active and archived lists', ({
    given,
    and,
    when,
    then,
  }) => {
    let result: { active: Account[]; archived: Account[] };
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I split the accounts for manage with query "(.*)"$/, (query: string) => {
      result = splitAccountsForManage(accounts, query);
    });
    then(/^the active names should be "(.*)"$/, (names: string) => {
      expect(result.active.map((a) => a.name)).toEqual(names.split(', '));
    });
    and(/^the archived names should be "(.*)"$/, (names: string) => {
      expect(result.archived.map((a) => a.name)).toEqual(names.split(', '));
    });
  });

  // ── hasArchivedAccounts ───────────────────────────────────────────────────
  test('False when there are no accounts at all', ({ given, then }) => {
    given(/^no accounts$/, () => {
      accounts = [];
    });
    then(/^hasArchivedAccounts should be (true|false)$/, (expected: string) => {
      expect(hasArchivedAccounts(accounts)).toBe(expected === 'true');
    });
  });

  test('False when every account is active', ({ given, and, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an account "(.*)"$/, pushAccount);
    then(/^hasArchivedAccounts should be (true|false)$/, (expected: string) => {
      expect(hasArchivedAccounts(accounts)).toBe(expected === 'true');
    });
  });

  test('True when at least one account is archived', ({ given, and, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    then(/^hasArchivedAccounts should be (true|false)$/, (expected: string) => {
      expect(hasArchivedAccounts(accounts)).toBe(expected === 'true');
    });
  });

  // ── archiveActionFor ──────────────────────────────────────────────────────
  test('Offers unarchive for an archived account', ({ given, then }) => {
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    then(/^archiveActionFor should be "(.*)"$/, (expected: string) => {
      expect(archiveActionFor(accounts[0]!)).toBe(expected);
    });
  });

  test('Offers archive for an active account', ({ given, then }) => {
    given(/^an account "(.*)"$/, pushAccount);
    then(/^archiveActionFor should be "(.*)"$/, (expected: string) => {
      expect(archiveActionFor(accounts[0]!)).toBe(expected);
    });
  });

  test('Offers archive when archived was never set', ({ given, then }) => {
    given(/^an account "(.*)" with archived left undefined$/, pushAccountWithUndefinedArchived);
    then(/^archiveActionFor should be "(.*)"$/, (expected: string) => {
      expect(accounts[0]!.archived).toBeUndefined();
      expect(archiveActionFor(accounts[0]!)).toBe(expected);
    });
  });

  // ── recommendArchiveOverDelete ────────────────────────────────────────────
  test('Recommends archive when the account has transactions', ({ given, when, then }) => {
    let impact: AccountDeleteImpact;
    given(/^a \$10 expense on account "(.*)"$/, (accountId: string) => {
      transactions.push(makeTransaction({ accountId, type: 'expense', amount: money('10') }));
    });
    when(/^I compute the delete impact for account "(.*)"$/, (accountId: string) => {
      impact = computeAccountDeleteImpact(accountId, transactions, series);
    });
    then(/^recommendArchiveOverDelete should be (true|false)$/, (expected: string) => {
      expect(recommendArchiveOverDelete(impact)).toBe(expected === 'true');
    });
  });

  test('Does not recommend archive when the account has no transactions', ({
    given,
    when,
    then,
  }) => {
    let impact: AccountDeleteImpact;
    given(/^no transactions$/, () => {
      transactions = [];
    });
    when(/^I compute the delete impact for account "(.*)"$/, (accountId: string) => {
      impact = computeAccountDeleteImpact(accountId, transactions, series);
    });
    then(/^recommendArchiveOverDelete should be (true|false)$/, (expected: string) => {
      expect(recommendArchiveOverDelete(impact)).toBe(expected === 'true');
    });
  });

  // ── collidesWithActiveName (§8.4) ─────────────────────────────────────────
  // In every scenario below, the account being restored (accounts[0]) is
  // always the first one declared — always via "an archived account", since
  // only an archived account is ever restored.
  test('Restoring collides with an active account of the same name', ({
    given,
    and,
    when,
    then,
  }) => {
    let collides: boolean;
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I check whether restoring it collides with an active name$/, () => {
      collides = collidesWithActiveName(accounts[0]!, accounts);
    });
    then(/^collidesWithActiveName should be (true|false)$/, (expected: string) => {
      expect(collides).toBe(expected === 'true');
    });
  });

  test('A collision is detected across case and whitespace differences', ({
    given,
    and,
    when,
    then,
  }) => {
    let collides: boolean;
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I check whether restoring it collides with an active name$/, () => {
      collides = collidesWithActiveName(accounts[0]!, accounts);
    });
    then(/^collidesWithActiveName should be (true|false)$/, (expected: string) => {
      expect(collides).toBe(expected === 'true');
    });
  });

  test('No collision when no other account shares the name', ({ given, and, when, then }) => {
    let collides: boolean;
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an account "(.*)"$/, pushAccount);
    when(/^I check whether restoring it collides with an active name$/, () => {
      collides = collidesWithActiveName(accounts[0]!, accounts);
    });
    then(/^collidesWithActiveName should be (true|false)$/, (expected: string) => {
      expect(collides).toBe(expected === 'true');
    });
  });

  test('No collision against itself when it is the only account', ({ given, when, then }) => {
    let collides: boolean;
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    when(/^I check whether restoring it collides with an active name$/, () => {
      collides = collidesWithActiveName(accounts[0]!, accounts);
    });
    then(/^collidesWithActiveName should be (true|false)$/, (expected: string) => {
      expect(collides).toBe(expected === 'true');
    });
  });

  test('No collision when the same-named account is also archived', ({
    given,
    and,
    when,
    then,
  }) => {
    let collides: boolean;
    given(/^an archived account "(.*)"$/, pushArchivedAccount);
    and(/^an archived account "(.*)"$/, pushArchivedAccount);
    when(/^I check whether restoring it collides with an active name$/, () => {
      collides = collidesWithActiveName(accounts[0]!, accounts);
    });
    then(/^collidesWithActiveName should be (true|false)$/, (expected: string) => {
      expect(collides).toBe(expected === 'true');
    });
  });
});
