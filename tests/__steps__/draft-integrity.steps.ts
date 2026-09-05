import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import { TransactionDraft, buildTransaction } from '../../src/domain/assistant';
import {
  checkDraftIntegrity,
  assertDraftIsSaveable,
  DraftAccountGoneError,
  DraftTransferAccountGoneError,
  DraftCurrencyStaleError,
  DraftIntegrityStatus,
} from '../../src/domain/draftIntegrity';
import { makeAccount, money } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/draft-integrity.feature'));

function makeDraft(partial: Partial<TransactionDraft> & Pick<TransactionDraft, 'accountId'>): TransactionDraft {
  return {
    type: 'expense',
    amount: 0,
    currency: 'SGD',
    categoryName: null,
    payeeName: null,
    note: null,
    occurredAt: Date.UTC(2026, 0, 1),
    source: 'ai',
    defaulted: { account: false, payee: false, category: false, date: false },
    ...partial,
  };
}

defineFeature(feature, (test) => {
  let accounts: Account[];
  let draft: TransactionDraft;
  let status: DraftIntegrityStatus;
  let tx: Transaction;

  // Background: two accounts, "Wallet" (used as most scenarios' single
  // account/transfer source) and "Savings" (the transfer destination in the
  // transfer scenarios). Two Gherkin lines with the same wording pattern
  // need two separate registrations, consumed in order — see
  // ai-assistant.steps.ts's givenAsset/andAsset for the same convention.
  const givenBackground = (given: any, and: any) => {
    given(
      /^an asset account "(.*)" with opening balance (.*) and currency "(.*)"$/,
      (name: string, bal: string, currency: string) => {
        accounts = [makeAccount({ name, openingBalance: money(bal), currency })];
      }
    );
    and(
      /^an asset account "(.*)" with opening balance (.*) and currency "(.*)"$/,
      (name: string, bal: string, currency: string) => {
        accounts.push(makeAccount({ name, openingBalance: money(bal), currency }));
      }
    );
  };

  const givenDraft = (given: any) =>
    given(
      /^a draft against "(.*)" with amount (.*) and currency "(.*)"$/,
      (accountName: string, amt: string, currency: string) => {
        const account = accounts.find((a) => a.name === accountName)!;
        draft = makeDraft({ accountId: account.id, amount: money(amt), currency });
      }
    );

  const givenTransferDraft = (given: any) =>
    given(
      /^a transfer draft from "(.*)" to "(.*)" with amount (.*)$/,
      (fromName: string, toName: string, amt: string) => {
        const from = accounts.find((a) => a.name === fromName)!;
        const to = accounts.find((a) => a.name === toName)!;
        draft = makeDraft({
          accountId: from.id,
          type: 'transfer',
          amount: money(amt),
          currency: from.currency,
          transferAccountId: to.id,
          transferAccountName: to.name,
        });
      }
    );

  const givenDeleted = (and: any) =>
    and(/^the account "(.*)" is deleted$/, (name: string) => {
      accounts = accounts.filter((a) => a.name !== name);
    });

  const givenRelabelled = (and: any) =>
    and(/^the account "(.*)" is relabelled to currency "(.*)"$/, (name: string, currency: string) => {
      accounts = accounts.map((a) => (a.name === name ? { ...a, currency } : a));
    });

  const thenStatus = (then: any) =>
    then(/^the draft integrity check should be "(.*)"$/, (expected: string) => {
      status = checkDraftIntegrity(draft, accounts);
      expect(status).toBe(expected);
    });

  const thenNoThrow = (and: any) =>
    and('asserting the draft is saveable should not throw', () => {
      expect(() => assertDraftIsSaveable(draft, accounts)).not.toThrow();
    });

  test('A draft whose account still exists is saveable', ({ given, then, and }) => {
    givenBackground(given, and);
    givenDraft(and);
    thenStatus(then);
    thenNoThrow(and);
  });

  test('A draft whose account was deleted is refused', ({ given, then, and }) => {
    givenBackground(given, and);
    givenDraft(and);
    givenDeleted(and);
    thenStatus(then);
    and(/^asserting the draft is saveable should throw a DraftAccountGoneError$/, () => {
      expect(() => assertDraftIsSaveable(draft, accounts)).toThrow(DraftAccountGoneError);
    });
  });

  test("A draft whose account's currency was relabelled since is refused", ({ given, then, and }) => {
    givenBackground(given, and);
    givenDraft(and);
    givenRelabelled(and);
    thenStatus(then);
    and(/^asserting the draft is saveable should throw a DraftCurrencyStaleError$/, () => {
      expect(() => assertDraftIsSaveable(draft, accounts)).toThrow(DraftCurrencyStaleError);
    });
  });

  test('A draft whose account is untouched still saves byte-identical', ({ given, when, then, and }) => {
    givenBackground(given, and);
    givenDraft(and);

    when('I build the transaction from that draft', () => {
      tx = buildTransaction(draft, {
        id: 'tx-1',
        createdAt: Date.UTC(2026, 0, 1),
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the built transaction's accountId should be "(.*)"$/, (name: string) => {
      const account = accounts.find((a) => a.name === name)!;
      expect(tx.accountId).toBe(account.id);
    });

    and(/^the built transaction's currency should be "(.*)"$/, (currency: string) => {
      expect(tx.currency).toBe(currency);
    });

    and(/^the built transaction's amount should be (.*)$/, (amount: string) => {
      expect(tx.amount).toBe(Number(amount));
    });
  });

  test('A transfer draft whose destination account still exists is saveable', ({ given, then, and }) => {
    givenBackground(given, and);
    givenTransferDraft(and);
    thenStatus(then);
    thenNoThrow(and);
  });

  test('A transfer draft whose destination account was deleted is refused', ({ given, then, and }) => {
    givenBackground(given, and);
    givenTransferDraft(and);
    givenDeleted(and);
    thenStatus(then);
    and(/^asserting the draft is saveable should throw a DraftTransferAccountGoneError$/, () => {
      expect(() => assertDraftIsSaveable(draft, accounts)).toThrow(DraftTransferAccountGoneError);
    });
  });
});
