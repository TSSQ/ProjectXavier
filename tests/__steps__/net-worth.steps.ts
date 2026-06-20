import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account } from '../../src/domain/types';
import { totalAssets, totalLiabilities, netWorth } from '../../src/domain/balances';
import { makeAccount, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/net-worth.feature')
);

defineFeature(feature, (test) => {
  let accounts: Account[] = [];

  beforeEach(() => {
    accounts = [];
  });

  const addAsset = (name: string, bal: string) =>
    accounts.push(
      makeAccount({ name, type: 'asset', openingBalance: money(bal) })
    );
  const addLiability = (name: string, bal: string) =>
    accounts.push(
      makeAccount({ name, type: 'liability', openingBalance: money(bal) })
    );
  const addArchivedAsset = (name: string, bal: string) =>
    accounts.push(
      makeAccount({
        name,
        type: 'asset',
        openingBalance: money(bal),
        archived: true,
      })
    );

  test('Net worth combines assets and liabilities', ({ given, and, then }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(/^a liability account "(.*)" with opening balance (.*)$/, addLiability);
    then(/^the total assets should be (.*)$/, (v) =>
      expect(totalAssets(accounts, [])).toBe(money(v))
    );
    and(/^the total liabilities should be (.*)$/, (v) =>
      expect(totalLiabilities(accounts, [])).toBe(money(v))
    );
    and(/^the net worth should be (.*)$/, (v) =>
      expect(netWorth(accounts, [])).toBe(money(v))
    );
  });

  test('Archived accounts are excluded from net worth', ({ given, and, then }) => {
    given(/^an asset account "(.*)" with opening balance (.*)$/, addAsset);
    and(
      /^an archived asset account "(.*)" with opening balance (.*)$/,
      addArchivedAsset
    );
    then(/^the net worth should be (.*)$/, (v) =>
      expect(netWorth(accounts, [])).toBe(money(v))
    );
  });
});
