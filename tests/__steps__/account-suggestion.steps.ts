import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { findAccountMentionInText } from '../../src/domain/accountMatch';
import { applyGroundingGuards, NormalizedDeviceParse } from '../../src/domain/deviceParsePrompt';
import {
  interpret,
  acceptAccountSuggestion,
  dismissAccountSuggestion,
  TransactionDraft,
} from '../../src/domain/assistant';
import { aiParsedExpenseSchema } from '../../src/lib/validation';
import { Account } from '../../src/domain/types';
import { makeAccount } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-suggestion.feature'));

const NOW = Date.UTC(2026, 8, 24);

const ACCOUNTS: Account[] = [
  makeAccount({ id: 'acc-uob', name: 'UOB One', currency: 'SGD' }),
  makeAccount({ id: 'acc-pools', name: 'SG Pools', currency: 'SGD' }),
  makeAccount({ id: 'acc-cash', name: 'Cash', currency: 'SGD' }),
  makeAccount({ id: 'acc-travel', name: 'Travel Card', currency: 'USD' }),
];

const nameOf = (id: string) => ACCOUNTS.find((a) => a.id === id)?.name;

defineFeature(feature, (test) => {
  let mentioned: Account | null;
  let grounded: NormalizedDeviceParse;
  let draft: TransactionDraft;
  let amountBeforeUse: number;

  const givenAccounts = (given: any) => given(/^the known accounts .*$/, () => {});

  const whenLookFor = (when: any) =>
    when(/^I look for an account mentioned in "(.*)"$/, (text: string) => {
      mentioned = findAccountMentionInText(text, ACCOUNTS);
    });

  // What either engine (FM deviceParse, BYOK engines/shared) hands interpret():
  // the model's account only after applyGroundingGuards has had its say.
  const groundedAccount = (account: string | null, text: string) =>
    applyGroundingGuards(
      {
        amount: null,
        currency: null,
        type: null,
        category: null,
        payee: null,
        account,
        note: null,
        occurredAt: null,
        confidence: 1,
        pending: false,
      },
      text
    ).account;

  const whenInterpret = (when: any) =>
    when(
      /^I interpret "(.*)" with the model's account (?:"(.*)"|none)$/,
      (text: string, account: string | undefined) => {
        const amount = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
        const currency = text.match(/\b(SGD|USD)\b/)?.[1] ?? 'SGD';
        const parsed = aiParsedExpenseSchema.parse({
          amount,
          currency,
          type: 'expense',
          category: 'Entertainment',
          payee: null,
          account: groundedAccount(account ?? null, text),
          note: null,
          occurredAt: NOW,
          confidence: 1,
        });
        const outcome = interpret(parsed, {
          accounts: ACCOUNTS,
          defaultAccountId: 'acc-uob',
          now: NOW,
          text,
        });
        if (outcome.kind !== 'confirm') throw new Error(`expected a draft, got ${outcome.kind}`);
        draft = outcome.draft;
      }
    );

  const thenStaysOn = (then: any) =>
    then(/^the draft should stay on "(.*)"$/, (name: string) => {
      expect(nameOf(draft.accountId)).toBe(name);
    });
  const thenSuggests = (and: any) =>
    and(/^the draft should suggest "(.*)"$/, (name: string) => {
      expect(draft.accountSuggestion?.name).toBe(name);
    });
  const thenNoSuggestion = (and: any) =>
    and(/^the draft should not suggest an account$/, () => {
      expect(draft.accountSuggestion).toBeUndefined();
    });

  test('A near-miss of a real account name in the text is found', ({ given, when, then }) => {
    givenAccounts(given);
    whenLookFor(when);
    then(/^the mentioned account should be "(.*)"$/, (name: string) => {
      expect(mentioned?.name).toBe(name);
    });
  });

  test('Words that merely resemble an account are not a mention', ({ given, when, then }) => {
    givenAccounts(given);
    whenLookFor(when);
    then(/^no account should be mentioned$/, () => {
      expect(mentioned).toBeNull();
    });
  });

  test('The guard drops the model\'s correct "SG Pools" because the user typed "sg pool"', ({
    when,
    then,
  }) => {
    when(/^the model names account "(.*)" for "(.*)"$/, (account: string, text: string) => {
      grounded = applyGroundingGuards(
        {
          amount: 20,
          currency: null,
          type: 'expense',
          category: null,
          payee: null,
          account,
          note: null,
          occurredAt: null,
          confidence: 1,
          pending: false,
        },
        text,
        'SGD'
      );
    });
    then(/^the grounded parse should have no account$/, () => {
      expect(grounded.account).toBeNull();
    });
  });

  test('interpret() offers the account whatever the model said', ({ given, when, then, and }) => {
    givenAccounts(given);
    whenInterpret(when);
    thenStaysOn(then);
    thenSuggests(and);
  });

  test('An exact account name resolves directly — nothing to suggest', ({ given, when, then, and }) => {
    givenAccounts(given);
    whenInterpret(when);
    thenStaysOn(then);
    thenNoSuggestion(and);
  });

  test('A near-miss of the account the draft is already on is not offered back', ({
    given,
    when,
    then,
    and,
  }) => {
    givenAccounts(given);
    whenInterpret(when);
    thenStaysOn(then);
    thenNoSuggestion(and);
  });

  test('Using the suggestion moves the draft and clears "not found"', ({ given, when, and, then }) => {
    givenAccounts(given);
    whenInterpret(when);
    and(/^I use the account suggestion$/, () => {
      draft = acceptAccountSuggestion(draft);
    });
    thenStaysOn(then);
    and(/^the draft account should not be defaulted$/, () => {
      expect(draft.defaulted.account).toBe(false);
    });
    and(/^the draft should have no unmatched account name$/, () => {
      expect(draft.unmatchedAccountName).toBeUndefined();
    });
    thenNoSuggestion(and);
  });

  test('Keeping the account dismisses the suggestion and changes nothing else', ({
    given,
    when,
    and,
    then,
  }) => {
    givenAccounts(given);
    whenInterpret(when);
    and(/^I keep the account$/, () => {
      draft = dismissAccountSuggestion(draft);
    });
    thenStaysOn(then);
    and(/^the draft account should be defaulted$/, () => {
      expect(draft.defaulted.account).toBe(true);
    });
    thenNoSuggestion(and);
  });

  test('Using a suggestion in another currency asks, never converts', ({ given, when, and, then }) => {
    givenAccounts(given);
    whenInterpret(when);
    and(/^I use the account suggestion$/, () => {
      amountBeforeUse = draft.amount;
      draft = acceptAccountSuggestion(draft);
    });
    thenStaysOn(then);
    and(/^the draft should flag the currency "(.*)" as mismatched$/, (code: string) => {
      expect(draft.mismatchedCurrency).toBe(code);
      expect(draft.amount).toBe(amountBeforeUse);
    });
  });
});
