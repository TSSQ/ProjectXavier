import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { buildAccountDeleteHandoff, AccountDeleteHandoff } from '../../src/domain/accountDeleteHandoff';
import { AccountDeleteImpact } from '../../src/domain/accountDeleteImpact';
import { Account } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-delete-handoff.feature'));

defineFeature(feature, (test) => {
  let target: Account;
  let allAccounts: Account[];
  let impact: AccountDeleteImpact;
  let handoff: AccountDeleteHandoff;

  test('A delete with cross-account transfers names the counterparty and offers the deep link', ({
    given,
    when,
    then,
    and,
  }) => {
    given(
      /^the account "(.*)" \((.*)\) with (\d+) transactions, (\d+) of them transfers with "(.*)" \((.*)\)$/,
      (name: string, id: string, txCount: string, transferCount: string, cpName: string, cpId: string) => {
        target = { id, name, currency: 'USD', openingBalance: 0 };
        const counterparty: Account = { id: cpId, name: cpName, currency: 'USD', openingBalance: 0 };
        allAccounts = [target, counterparty];
        impact = {
          transactionCount: Number(txCount),
          transferCount: Number(transferCount),
          counterpartyAccountIds: [cpId],
          recurringSeriesIds: [],
        };
      }
    );
    when(/^I build the delete handoff for "(.*)"$/, () => {
      handoff = buildAccountDeleteHandoff(target, impact, allAccounts);
    });
    then(/^the handoff message should mention "(.*)"$/, (text: string) => {
      expect(handoff.message).toContain(text);
    });
    and(/^the handoff message should mention "(.*)"$/, (text: string) => {
      expect(handoff.message).toContain(text);
    });
    and(/^the handoff deep link should be "(.*)"$/, (link: string) => {
      expect(handoff.deepLink).toBe(link);
    });
  });

  test('A delete with recurring rules names them in the warning', ({ given, when, then }) => {
    given(
      /^the account "(.*)" \((.*)\) with (\d+) recurring rules referencing it$/,
      (name: string, id: string, count: string) => {
        target = { id, name, currency: 'USD', openingBalance: 0 };
        allAccounts = [target];
        impact = {
          transactionCount: 0,
          transferCount: 0,
          counterpartyAccountIds: [],
          recurringSeriesIds: Array.from({ length: Number(count) }, (_, i) => `series-${i}`),
        };
      }
    );
    when(/^I build the delete handoff for "(.*)"$/, () => {
      handoff = buildAccountDeleteHandoff(target, impact, allAccounts);
    });
    then(/^the handoff message should mention "(.*)"$/, (text: string) => {
      expect(handoff.message).toContain(text);
    });
  });
});
