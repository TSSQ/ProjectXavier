import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { readSign, resolveSign, isTransactionKindWord } from '../../src/domain/signReader';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { localParse } from '../../src/domain/localParse';
import { Account, TransactionType } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/sign-reader.feature'));

const NOW = Date.UTC(2026, 6, 16, 4);
const FIELDS = {
  currency: '', category: '', account: '', note: '', occurredOn: '', confidence: 0.9, pending: false,
};

const accountsFrom = (names: string): Account[] =>
  names.split(',').map((n, i) => ({ id: `acct-${i}`, name: n.trim(), currency: 'USD', openingBalance: 0 }));

defineFeature(feature, (test) => {
  let accounts: Account[] = [];
  let modelType: TransactionType = 'expense';
  let text = '';
  let payee = '';
  let finished: FmDeviceParse | null = null;

  beforeEach(() => {
    accounts = [];
    modelType = 'expense';
    finished = null;
  });

  const givenAccounts = (given: any) =>
    given(/^the user's accounts are "(.*)"$/, (names: string) => { accounts = accountsFrom(names); });
  const givenModelType = (given: any) =>
    given(/^the model's type is "(.*)"$/, (t: string) => { modelType = t as TransactionType; });
  const thenSign = (then: any) =>
    then(/^the sign read from "(.*)" is "(expense|income|transfer)"$/, (t: string, type: string) => {
      expect({ t, type: readSign(t, accounts)?.type }).toEqual({ t, type });
    });
  const thenUndecided = (then: any) =>
    then(/^the sign read from "(.*)" is undecided$/, (t: string) => {
      expect({ t, read: readSign(t, accounts) }).toEqual({ t, read: null });
    });
  const thenResolved = (then: any) =>
    then(/^the resolved type for "(.*)" is "(.*)"$/, (t: string, type: string) => {
      expect({ t, type: resolveSign(t, modelType, accounts).type }).toEqual({ t, type });
    });

  test('Income words, a leading plus and received money are income', ({ then }) => thenSign(then));
  test('Spend verbs and spend nouns are expenses, whatever else the text says', ({ then }) => thenSign(then));
  test("A transfer needs a transfer verb and one of the user's own accounts", ({ given, then }) => {
    givenAccounts(given);
    thenSign(then);
  });
  test('A transfer verb pointed at a person is a payment, not a transfer', ({ given, then }) => {
    givenAccounts(given);
    thenSign(then);
  });
  test('A partial account name after "to" still names the user\'s own account', ({ given, then }) => {
    givenAccounts(given);
    thenSign(then);
  });
  test('Where the words leave the type open, the reader says nothing', ({ then }) => thenUndecided(then));
  test("The pipeline keeps the model's type where the reader is undecided", ({ given, then }) => {
    givenModelType(given);
    thenResolved(then);
  });
  test('A model transfer that nothing in the text supports becomes an expense', ({ given, then }) => {
    givenModelType(given);
    thenResolved(then);
  });
  test('A model transfer with a transfer verb or an account word is kept', ({ given, and, then }) => {
    givenAccounts(given);
    givenModelType(and);
    thenResolved(then);
  });
  test('A transaction-kind word is never a payee', ({ then }) => {
    then(/^"(.*)" is a transaction-kind word, not a payee$/, (w: string) => {
      expect(isTransactionKindWord(w)).toBe(true);
    });
  });
  test('A merchant or person is not a transaction-kind word', ({ then }) => {
    then(/^"(.*)" can be a payee$/, (w: string) => {
      expect(isTransactionKindWord(w)).toBe(false);
    });
  });

  const givenLogged = (given: any) =>
    given(/^the model logged "(.*)" as "(.*)" with payee "(.*)"$/, (t: string, type: string, p: string) => {
      text = t;
      modelType = type as TransactionType;
      payee = p === 'none' ? '' : p;
    });
  const whenFinished = (when: any) =>
    when('the FM parse is finished', () => {
      const plan = planFmAmount(text);
      const object: Record<string, unknown> = { ...FIELDS, isTransaction: true, type: modelType, payee };
      if (plan.mode !== 'single') throw new Error(`test texts must have one amount: ${text}`);
      finished = finishFmParse(object, text, plan, NOW, 'USD', accounts);
    });
  const thenFinished = (then: any) =>
    then(/^the finished parse has type "(.*)" and payee (none|"(?:.*)")$/, (type: string, result: string) => {
      expect(finished).not.toBeNull();
      expect({ text, type: finished!.type }).toEqual({ text, type });
      expect(finished!.payee).toBe(result === 'none' ? null : result.slice(1, -1));
      expect(finished!.amount).toBeGreaterThan(0);
    });

  test("The on-device parse takes the read sign over the model's and drops a kind-word payee", ({ given, when, then }) => {
    givenLogged(given);
    whenFinished(when);
    thenFinished(then);
  });
  test("The on-device parse uses the user's accounts for the transfer rule", ({ given, and, when, then }) => {
    givenAccounts(given);
    givenLogged(and);
    whenFinished(when);
    thenFinished(then);
  });

  test('The heuristic floor uses the same reader where it decides', ({ when, then }) => {
    let type: TransactionType;
    when(/^I locally parse "(.*)"$/, (t: string) => {
      type = localParse(t, { categories: [], payees: [], now: NOW }).type!;
    });
    then(/^the heuristic type is "(.*)"$/, (expected: string) => expect(type).toBe(expected));
  });
});
