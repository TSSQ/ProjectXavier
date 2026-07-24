import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  resolveUpdatedAccount,
  AccountUpdateDraft,
  AccountUpdateWrite,
} from '../../src/domain/accountUpdateAssistant';
import { Account } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-update-write.feature'));

defineFeature(feature, (test) => {
  let existing: Account;
  let draft: AccountUpdateDraft;
  let write: AccountUpdateWrite;

  const givenExisting = (name: string, balance: string) => {
    existing = {
      id: 'acc-1',
      name,
      subtype: 'bank',
      currency: 'USD',
      openingBalance: Number(balance),
    };
  };

  const givenDraft = (
    op: string,
    newName: string,
    newSubtype: string | undefined,
    newBalance: string,
    balanceEdited: string
  ) => {
    draft = {
      op: op as AccountUpdateDraft['op'],
      newName,
      newSubtype: newSubtype || undefined,
      newBalance: Number(newBalance),
      balanceEdited: balanceEdited === 'true',
    };
  };

  const DRAFT_RE =
    /^an update draft with op "(.*)" newName "(.*)"(?: newSubtype "(.*)")? newBalance (\d+) balanceEdited (true|false)$/;

  const whenResolve = () => {
    write = resolveUpdatedAccount(existing, draft);
  };

  const thenBalance = (expected: string) => {
    expect(write.openingBalance).toBe(Number(expected));
  };

  test("A rename preserves the existing balance even if the draft's newBalance is wrong", ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an existing account "(.*)" with balance (\d+)$/, givenExisting);
    given(DRAFT_RE, givenDraft);
    when(/^I resolve the write for that draft$/, whenResolve);
    then(/^the written openingBalance should be (\d+)$/, thenBalance);
    and(/^the written name should be "(.*)"$/, (expected: string) => {
      expect(write.name).toBe(expected);
    });
  });

  test("A retype preserves the existing balance even if the draft's newBalance is wrong", ({
    given,
    when,
    then,
  }) => {
    given(/^an existing account "(.*)" with balance (\d+)$/, givenExisting);
    given(DRAFT_RE, givenDraft);
    when(/^I resolve the write for that draft$/, whenResolve);
    then(/^the written openingBalance should be (\d+)$/, thenBalance);
  });

  test('A rebalance DOES change the balance', ({ given, when, then }) => {
    given(/^an existing account "(.*)" with balance (\d+)$/, givenExisting);
    given(DRAFT_RE, givenDraft);
    when(/^I resolve the write for that draft$/, whenResolve);
    then(/^the written openingBalance should be (\d+)$/, thenBalance);
  });

  test('A manual balance edit on a rename is honored', ({ given, when, then }) => {
    given(/^an existing account "(.*)" with balance (\d+)$/, givenExisting);
    given(DRAFT_RE, givenDraft);
    when(/^I resolve the write for that draft$/, whenResolve);
    then(/^the written openingBalance should be (\d+)$/, thenBalance);
  });
});
