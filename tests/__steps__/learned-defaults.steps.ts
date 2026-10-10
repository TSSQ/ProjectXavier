import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Category, Payee, TransactionType } from '../../src/domain/types';
import { TransactionDraft } from '../../src/domain/assistant';
import {
  applyLearnedDefaults,
  payeeDefaultsPatch,
  PayeeDefaultsPatch,
  revertLearnedAccount,
  revertLearnedCategory,
} from '../../src/domain/learnedDefaults';
import { makeAccount, nextId } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/learned-defaults.feature'));

defineFeature(feature, (test) => {
  let categories: Category[];
  let accounts: Account[];
  let payees: Payee[];
  let text: string;
  let draft: TransactionDraft;
  let before: TransactionDraft;
  let patch: PayeeDefaultsPatch | null;

  beforeEach(() => {
    categories = [];
    accounts = [];
    payees = [];
    text = '';
  });

  const category = (name: string) => categories.find((c) => c.name === name)!;
  const account = (name: string) => accounts.find((a) => a.name === name)!;
  const payee = (name: string) => payees.find((p) => p.name === name)!;

  const baseDraft = (type: TransactionType, acct: Account): TransactionDraft => ({
    accountId: acct.id,
    type,
    amount: 600,
    currency: acct.currency,
    categoryName: null,
    payeeName: null,
    note: null,
    occurredAt: Date.UTC(2026, 0, 1),
    source: 'ai',
    defaulted: { account: false, payee: false, category: false, date: false },
  });

  const apply = () => {
    before = draft;
    draft = applyLearnedDefaults(draft, { payees, categories, accounts, text });
  };

  // ── Background ───────────────────────────────────────────────────────────
  const background = (given: any, and: any) => {
    given(/^categories:$/, (table: Array<{ name: string; kind: TransactionType }>) => {
      categories = table.map((r) => ({ id: nextId('cat'), name: r.name, kind: r.kind }));
    });
    and(/^accounts:$/, (table: Array<{ name: string; currency: string }>) => {
      accounts = table.map((r) => makeAccount({ name: r.name, currency: r.currency }));
    });
    and(
      /^a payee "(.*)" remembering category "(.*)" and account "(.*)"$/,
      (name: string, cat: string, acct: string) => {
        payees.push({
          id: nextId('payee'),
          name,
          defaultCategoryId: category(cat).id,
          defaultAccountId: account(acct).id,
        });
      }
    );
  };

  // ── Givens ───────────────────────────────────────────────────────────────
  const givenDraftWithCategory = (given: any) =>
    given(
      /^an? (expense|income) draft for payee "(.*)" with category "(.*)" from (?:the text "(.*)"|no text)$/,
      (type: TransactionType, payeeName: string, cat: string, words: string | undefined) => {
        draft = { ...baseDraft(type, account('Wallet')), payeeName, categoryName: cat };
        text = words ?? '';
      }
    );

  const givenDraftWithoutCategory = (given: any) =>
    given(
      /^an expense draft for payee "(.*)" with no category from the text "(.*)"$/,
      (payeeName: string, words: string) => {
        draft = {
          ...baseDraft('expense', account('Wallet')),
          payeeName,
          categoryName: null,
          defaulted: { account: false, payee: false, category: true, date: false },
        };
        text = words;
      }
    );

  const givenDraftOnAccount = (given: any) =>
    given(
      /^an expense draft for payee "([^"]*)" on the (defaulted|named) account "([^"]*)"(?: after "([^"]*)" was not found)?(?: having heard "([^"]*)")?$/,
      (payeeName: string, how: string, acctName: string, unmatched?: string, heard?: string) => {
        draft = {
          ...baseDraft('expense', account(acctName)),
          payeeName,
          categoryName: 'Coffee',
          defaulted: { account: how === 'defaulted', payee: false, category: false, date: false },
          ...(unmatched ? { unmatchedAccountName: unmatched } : {}),
          ...(heard ? { mismatchedCurrency: heard } : {}),
        };
        text = `spent 6 at ${payeeName}`;
      }
    );

  const givenTransfer = (given: any) =>
    given(
      /^a transfer draft from the defaulted account "(.*)" to "(.*)"$/,
      (from: string, to: string) => {
        draft = {
          ...baseDraft('transfer', account(from)),
          transferAccountId: account(to).id,
          transferAccountName: to,
          defaulted: { account: true, payee: false, category: false, date: false },
        };
        text = `transfer 6 to ${to}`;
      }
    );

  const givenRemembersAccount = (given: any) =>
    given(/^the payee "(.*)" remembers the account "(.*)"$/, (name: string, acct: string) => {
      payee(name).defaultAccountId = account(acct).id;
    });

  const givenRemembersDeletedCategory = (given: any) =>
    given(/^the payee "(.*)" remembers a category that was deleted$/, (name: string) => {
      payee(name).defaultCategoryId = 'cat-gone';
    });

  const givenArchived = (given: any) =>
    given(/^the account "(.*)" is archived$/, (name: string) => {
      account(name).archived = true;
    });

  const givenApplied = (and: any) => and(/^learned defaults were applied$/, apply);

  // ── Whens ────────────────────────────────────────────────────────────────
  const whenApplied = (when: any) => when(/^learned defaults are applied$/, apply);
  const whenRevertCategory = (when: any) =>
    when(/^the learned category is reverted$/, () => {
      draft = revertLearnedCategory(draft);
    });
  const whenRevertAccount = (when: any) =>
    when(/^the learned account is reverted$/, () => {
      draft = revertLearnedAccount(draft);
    });
  const whenConfirms = (when: any) =>
    when(
      /^the user confirms (?:category "(.*)"|no category) on account "(.*)" for "(.*)"$/,
      (cat: string | undefined, acct: string, name: string) => {
        patch = payeeDefaultsPatch(payee(name), {
          categoryId: cat ? category(cat).id : null,
          accountId: account(acct).id,
        });
      }
    );

  // ── Thens ────────────────────────────────────────────────────────────────
  const thenCategory = (then: any) =>
    then(/^the draft's category should be "(.*)"$/, (name: string) => {
      expect(draft.categoryName).toBe(name);
    });
  const thenNoCategory = (then: any) =>
    then(/^the draft should have no category$/, () => {
      expect(draft.categoryName).toBeNull();
    });
  const thenCategoryFlagged = (and: any) =>
    and(
      /^the category should be flagged as learned, remembering the engine's (?:"(.*)"|nothing)$/,
      (engine: string | undefined) => {
        expect(draft.learnedCategory).toEqual({
          engineCategoryName: engine ?? null,
          engineDefaulted: engine === undefined,
        });
        expect(draft.defaulted.category).toBe(false);
      }
    );
  const thenCategoryNotFlagged = (and: any) =>
    and(/^the category should not be flagged as learned$/, () => {
      expect(draft.learnedCategory).toBeUndefined();
    });
  const thenCategoryDefaulted = (and: any) =>
    and(/^the category should be marked as defaulted$/, () => {
      expect(draft.defaulted.category).toBe(true);
    });
  const thenUnchanged = (then: any) =>
    then(/^the draft should be unchanged$/, () => {
      expect(draft).toBe(before);
    });
  const thenAccount = (then: any) =>
    then(/^the draft's account should be "(.*)"$/, (name: string) => {
      expect(draft.accountId).toBe(account(name).id);
    });
  const thenAccountFlagged = (and: any) =>
    and(
      /^the account should be flagged as learned, remembering the engine's "(.*)"$/,
      (name: string) => {
        expect(draft.learnedAccount?.engineAccountId).toBe(account(name).id);
      }
    );
  const thenAccountNotFlagged = (and: any) =>
    and(/^the account should not be flagged as learned$/, () => {
      expect(draft.learnedAccount).toBeUndefined();
    });
  const thenAccountNotDefaulted = (and: any) =>
    and(/^the account should not be marked as defaulted$/, () => {
      expect(draft.defaulted.account).toBe(false);
    });
  const thenAccountDefaulted = (and: any) =>
    and(/^the account should be marked as defaulted$/, () => {
      expect(draft.defaulted.account).toBe(true);
    });
  const thenCurrency = (and: any) =>
    and(/^the draft's currency should be "(.*)"$/, (code: string) => {
      expect(draft.currency).toBe(code);
    });
  const thenNoConflict = (and: any) =>
    and(/^the draft should have no currency conflict$/, () => {
      expect(draft.mismatchedCurrency).toBeUndefined();
    });
  const thenConflict = (and: any) =>
    and(/^the draft should have a currency conflict with "(.*)"$/, (code: string) => {
      expect(draft.mismatchedCurrency).toBe(code);
    });
  const thenLearns = (then: any) =>
    then(
      /^the payee should learn (?:category "(.*)" only|account "(.*)" only|category "(.*)" and account "(.*)"|nothing)$/,
      (catOnly?: string, acctOnly?: string, cat?: string, acct?: string) => {
        if (catOnly) expect(patch).toEqual({ defaultCategoryId: category(catOnly).id });
        else if (acctOnly) expect(patch).toEqual({ defaultAccountId: account(acctOnly).id });
        else if (cat && acct) {
          expect(patch).toEqual({
            defaultCategoryId: category(cat).id,
            defaultAccountId: account(acct).id,
          });
        } else expect(patch).toBeNull();
      }
    );

  // ── Scenarios ────────────────────────────────────────────────────────────
  test("The learned category wins over the engine's proposal", ({ given, and, when, then }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenCategory(then);
    thenCategoryFlagged(and);
  });

  test('A category the user typed wins over the learned one', ({ given, and, when, then }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenCategory(then);
    thenCategoryNotFlagged(and);
  });

  test("The learned category still wins when the user's words are unknown", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenCategory(then);
  });

  test('The learned category fills a draft the engine left without one', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithoutCategory(given);
    whenApplied(when);
    thenCategory(then);
    thenCategoryFlagged(and);
  });

  test('An unknown payee has nothing to teach', ({ given, and, when, then }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenUnchanged(then);
  });

  test('A close-but-not-exact payee is not trusted', ({ given, and, when, then }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenUnchanged(then);
  });

  test('A learned category of another kind never lands on the draft', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenUnchanged(then);
  });

  test('Proposing the learned category itself is not a replacement', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithCategory(given);
    whenApplied(when);
    thenCategory(then);
    thenCategoryNotFlagged(and);
  });

  test('A learned category that no longer exists is ignored', ({ given, and, when, then }) => {
    background(given, and);
    givenRemembersDeletedCategory(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    thenUnchanged(then);
  });

  test("Reverting the learned category restores the engine's proposal", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithCategory(given);
    givenApplied(and);
    whenRevertCategory(when);
    thenCategory(then);
    thenCategoryNotFlagged(and);
  });

  test('Reverting a learned category the engine never proposed clears it again', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftWithoutCategory(given);
    givenApplied(and);
    whenRevertCategory(when);
    thenNoCategory(then);
    thenCategoryDefaulted(and);
  });

  test('The learned account is used when the engine named none', ({ given, and, when, then }) => {
    background(given, and);
    givenDraftOnAccount(given);
    whenApplied(when);
    thenAccount(then);
    thenAccountFlagged(and);
    thenAccountNotDefaulted(and);
  });

  test('An account the engine named is kept', ({ given, and, when, then }) => {
    background(given, and);
    givenDraftOnAccount(given);
    whenApplied(when);
    thenAccount(then);
    thenAccountNotFlagged(and);
  });

  test('An account name the user gave but that did not resolve blocks the learned account', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenDraftOnAccount(given);
    whenApplied(when);
    thenAccount(then);
    thenAccountNotFlagged(and);
  });

  test('A learned account in another currency is never used silently', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenRemembersAccount(given);
    givenDraftOnAccount(and);
    whenApplied(when);
    thenAccount(then);
    thenAccountNotFlagged(and);
  });

  test('A learned account in the currency the user named resolves the conflict', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenRemembersAccount(given);
    givenDraftOnAccount(and);
    whenApplied(when);
    thenAccount(then);
    thenCurrency(and);
    thenNoConflict(and);
  });

  test('A learned account that is archived is ignored', ({ given, and, when, then }) => {
    background(given, and);
    givenArchived(given);
    givenDraftOnAccount(and);
    whenApplied(when);
    thenAccount(then);
  });

  test('A transfer never takes a learned account', ({ given, and, when, then }) => {
    background(given, and);
    givenTransfer(given);
    whenApplied(when);
    thenUnchanged(then);
  });

  test("Reverting the learned account restores the engine's account and its currency conflict", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenRemembersAccount(given);
    givenDraftOnAccount(and);
    givenApplied(and);
    whenRevertAccount(when);
    thenAccount(then);
    thenCurrency(and);
    thenConflict(and);
    thenAccountDefaulted(and);
  });

  test("A changed category becomes the payee's new default", ({ given, and, when, then }) => {
    background(given, and);
    whenConfirms(when);
    thenLearns(then);
  });

  test("A changed account becomes the payee's new default", ({ given, and, when, then }) => {
    background(given, and);
    whenConfirms(when);
    thenLearns(then);
  });

  test('Confirming what the payee already remembers writes nothing', ({ given, and, when, then }) => {
    background(given, and);
    whenConfirms(when);
    thenLearns(then);
  });

  test('Saving without a category never forgets the remembered one', ({ given, and, when, then }) => {
    background(given, and);
    whenConfirms(when);
    thenLearns(then);
  });

  test('A payee that remembers nothing learns both', ({ given, and, when, then }) => {
    background(given, and);
    given(/^a payee "(.*)" remembering nothing$/, (name: string) => {
      payees.push({ id: nextId('payee'), name, defaultCategoryId: null, defaultAccountId: null });
    });
    whenConfirms(when);
    thenLearns(then);
  });
});
