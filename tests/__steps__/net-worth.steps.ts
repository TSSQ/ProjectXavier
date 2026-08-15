import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import { netWorth, netWorthAsOf, netWorthOfAsOf } from '../../src/domain/balances';
import { makeAccount, makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/net-worth.feature')
);

// Comfortably after every transaction date this file's scenarios use
// (makeTransaction defaults occurredAt to 2026-01-01) — these scenarios are
// about the net-worth sum itself, not future-dating.
const NOW = Date.UTC(2026, 11, 31);

defineFeature(feature, (test) => {
  let accounts: Record<string, Account> = {};
  let transactions: Transaction[] = [];

  beforeEach(() => {
    accounts = {};
    transactions = [];
  });

  const add = (name: string, bal: string) => {
    accounts[name] = makeAccount({ name, openingBalance: money(bal) });
  };
  const addTagged = (name: string, tag: string, bal: string) => {
    accounts[name] = makeAccount({ name, tag, openingBalance: money(bal) });
  };
  const addArchived = (name: string, bal: string) => {
    accounts[name] = makeAccount({
      name,
      openingBalance: money(bal),
      archived: true,
    });
  };
  const thenNetWorth = (then: any) =>
    then(/^the net worth should be (.*)$/, (v: string) =>
      expect(netWorth(Object.values(accounts), transactions, NOW)).toBe(money(v))
    );

  test('Net worth is the signed sum of all balances', ({ given, and, then }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, add);
    and(/^an account "(.*)" with opening balance (.*)$/, add);
    thenNetWorth(then);
  });

  test('A cosmetic tag does not change net worth', ({ given, and, then }) => {
    given(
      /^an account "(.*)" tagged "(.*)" with opening balance (.*)$/,
      addTagged
    );
    and(
      /^an account "(.*)" tagged "(.*)" with opening balance (.*)$/,
      addTagged
    );
    thenNetWorth(then);
  });

  test('Archived accounts are excluded from net worth', ({ given, and, then }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, add);
    and(/^an archived account "(.*)" with opening balance (.*)$/, addArchived);
    thenNetWorth(then);
  });

  test('A transfer between accounts leaves net worth unchanged', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, add);
    and(/^an account "(.*)" with opening balance (.*)$/, add);
    when(/^I transfer (.*) from "(.*)" to "(.*)"$/, (amt: string, from: string, to: string) => {
      transactions.push(
        makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accounts[from]!.id,
          transferAccountId: accounts[to]!.id,
        })
      );
    });
    thenNetWorth(then);
  });

  // ── netWorthOfAsOf (spec §5.4, criterion 8) ────────────────────────────────
  test('netWorthOfAsOf includes archived accounts in its sum', ({ given, and, then }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, add);
    and(/^an archived account "(.*)" with opening balance (.*)$/, addArchived);
    then(/^the netWorthOfAsOf of all accounts should be (.*)$/, (v: string) => {
      expect(netWorthOfAsOf(Object.values(accounts), transactions, NOW)).toBe(money(v));
    });
  });

  test('netWorthOfAsOf matches netWorthAsOf when handed an already-filtered list', ({
    given,
    and,
    then,
  }) => {
    given(/^an account "(.*)" with opening balance (.*)$/, add);
    and(/^an archived account "(.*)" with opening balance (.*)$/, addArchived);
    then(
      /^netWorthOfAsOf on the active accounts should equal netWorthAsOf on all accounts$/,
      () => {
        const all = Object.values(accounts);
        const active = all.filter((a) => !a.archived);
        expect(netWorthOfAsOf(active, transactions, NOW)).toBe(
          netWorthAsOf(all, transactions, NOW)
        );
      }
    );
  });
});
