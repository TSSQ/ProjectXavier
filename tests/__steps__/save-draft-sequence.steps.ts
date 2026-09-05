import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Payee } from '../../src/domain/types';
import { TransactionDraft } from '../../src/domain/assistant';
import {
  DraftAccountGoneError,
  DraftTransferAccountGoneError,
  DraftCurrencyStaleError,
} from '../../src/domain/draftIntegrity';
import { saveAssistantDraftWith, SaveAssistantDraftDeps } from '../../src/features/ai/saveDraftSequence';
import { makeAccount, money } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/save-draft-sequence.feature'));

const ERRORS: Record<string, new () => Error> = {
  DraftAccountGoneError,
  DraftTransferAccountGoneError,
  DraftCurrencyStaleError,
};

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
  let now: number;
  let accounts: Account[];
  let calls: string[];
  let deps: SaveAssistantDraftDeps;
  let draft: TransactionDraft;
  let error: unknown;

  // "Ghost" never appears in `accounts` — a stand-in for an account id the
  // draft still remembers but that no longer exists in the (fake) DB, same
  // shape as a deleted account in production.
  const GHOST_ID = 'ghost-account-id';

  const accountIdFor = (name: string): string =>
    name === 'Ghost' ? GHOST_ID : accounts.find((a) => a.name === name)!.id;

  const makeFakeDeps = (): SaveAssistantDraftDeps => ({
    async listAccounts() {
      calls.push('listAccounts');
      return accounts;
    },
    async findOrCreateCategory(): Promise<string> {
      calls.push('findOrCreateCategory');
      return 'cat-1';
    },
    async getPayeeByName(): Promise<Payee | null> {
      calls.push('getPayeeByName');
      return null;
    },
    async findOrCreatePayee(): Promise<string> {
      calls.push('findOrCreatePayee');
      return 'payee-1';
    },
    async createSeries(): Promise<void> {
      calls.push('createSeries');
    },
    async createTransaction(): Promise<void> {
      calls.push('createTransaction');
    },
    async postDueOccurrences(): Promise<void> {
      calls.push('postDueOccurrences');
    },
    newId: () => `id-${calls.length}`,
    now: () => now,
  });

  const givenNow = (given: any) =>
    given('now is fixed for the sequence', () => {
      now = Date.UTC(2026, 0, 1);
      calls = [];
    });

  const givenRepoOne = (given: any) =>
    given(/^a fake repository with accounts "(.*)"$/, (name: string) => {
      accounts = [makeAccount({ name, currency: 'SGD' })];
      deps = makeFakeDeps();
    });

  const givenRepoOneWithCurrency = (given: any) =>
    given(/^a fake repository with accounts "(.*)" in "(.*)"$/, (name: string, currency: string) => {
      accounts = [makeAccount({ name, currency })];
      deps = makeFakeDeps();
    });

  const givenRepoTwo = (given: any) =>
    given(/^a fake repository with accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      accounts = [makeAccount({ name: a, currency: 'SGD' }), makeAccount({ name: b, currency: 'SGD' })];
      deps = makeFakeDeps();
    });

  const givenDraft = (and: any) =>
    and(/^a draft against account "(.*)" with amount (.*)$/, (name: string, amt: string) => {
      draft = makeDraft({ accountId: accountIdFor(name), amount: money(amt) });
    });

  const givenDraftWithCurrency = (and: any) =>
    and(
      /^a draft against account "(.*)" with amount (.*) and currency "(.*)"$/,
      (name: string, amt: string, currency: string) => {
        draft = makeDraft({ accountId: accountIdFor(name), amount: money(amt), currency });
      }
    );

  const givenDraftWithCategoryAndPayee = (and: any) =>
    and(
      /^a draft against account "(.*)" with amount (.*), category "(.*)" and payee "(.*)"$/,
      (name: string, amt: string, category: string, payee: string) => {
        draft = makeDraft({
          accountId: accountIdFor(name),
          amount: money(amt),
          categoryName: category,
          payeeName: payee,
        });
      }
    );

  const givenTransferDraft = (and: any) =>
    and(
      /^a transfer draft from "(.*)" to "(.*)" with amount (.*)$/,
      (fromName: string, toName: string, amt: string) => {
        const from = accounts.find((a) => a.name === fromName)!;
        draft = makeDraft({
          accountId: from.id,
          type: 'transfer',
          amount: money(amt),
          currency: from.currency,
          transferAccountId: accountIdFor(toName),
        });
      }
    );

  const whenSave = (when: any) =>
    when('I save the draft through the sequence', async () => {
      error = undefined;
      try {
        await saveAssistantDraftWith(deps, draft);
      } catch (e) {
        error = e;
      }
    });

  const thenLog = (and: any) =>
    and(/^the repository call log should be "(.*)"$/, (expected: string) => {
      expect(calls.join(' > ')).toBe(expected);
    });

  test('A draft whose account is gone is refused before any other repository call', ({
    given,
    when,
    then,
    and,
  }) => {
    givenNow(given);
    givenRepoOne(and);
    givenDraft(and);
    whenSave(when);
    then(/^the save should throw a DraftAccountGoneError$/, () => {
      expect(error).toBeInstanceOf(ERRORS.DraftAccountGoneError);
    });
    thenLog(and);
  });

  test("A draft whose account's currency changed is refused before any other repository call", ({
    given,
    when,
    then,
    and,
  }) => {
    givenNow(given);
    givenRepoOneWithCurrency(and);
    givenDraftWithCurrency(and);
    whenSave(when);
    then(/^the save should throw a DraftCurrencyStaleError$/, () => {
      expect(error).toBeInstanceOf(ERRORS.DraftCurrencyStaleError);
    });
    thenLog(and);
  });

  test('A transfer draft whose destination is gone is refused before any other repository call', ({
    given,
    when,
    then,
    and,
  }) => {
    givenNow(given);
    givenRepoOne(and);
    givenTransferDraft(and);
    whenSave(when);
    then(/^the save should throw a DraftTransferAccountGoneError$/, () => {
      expect(error).toBeInstanceOf(ERRORS.DraftTransferAccountGoneError);
    });
    thenLog(and);
  });

  test('A valid expense draft\'s calls land in order — guard, then category, then payee, then the row', ({
    given,
    when,
    then,
    and,
  }) => {
    givenNow(given);
    givenRepoOne(and);
    givenDraftWithCategoryAndPayee(and);
    whenSave(when);
    then('the save should not throw', () => {
      expect(error).toBeUndefined();
    });
    thenLog(and);
  });

  test('A valid transfer draft skips category/payee resolution entirely', ({ given, when, then, and }) => {
    givenNow(given);
    givenRepoTwo(and);
    givenTransferDraft(and);
    whenSave(when);
    then('the save should not throw', () => {
      expect(error).toBeUndefined();
    });
    thenLog(and);
  });
});
