import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { interpret, AssistantOutcome } from '../../src/domain/assistant';
import { aiParsedExpenseSchema } from '../../src/lib/validation';
import { makeAccount } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/transfer-partial-names.feature'));

const NOW = Date.UTC(2026, 8, 27);
const ACCOUNTS = [
  makeAccount({ id: 'uob-one', name: 'UOB One', currency: 'SGD' }),
  makeAccount({ id: 'uob-sav', name: 'UOB Savings', currency: 'SGD' }),
  makeAccount({ id: 'citi', name: 'Citibank', currency: 'SGD' }),
  makeAccount({ id: 'cash', name: 'Cash', currency: 'SGD' }),
];
const nameOf = (id: string) => ACCOUNTS.find((a) => a.id === id)?.name;

defineFeature(feature, (test) => {
  let outcome: AssistantOutcome;
  const draft = () => {
    if (outcome.kind !== 'confirm') throw new Error(`expected a draft, got ${outcome.kind}`);
    return outcome.draft;
  };

  const whenInterpret = (when: any) =>
    when(/^I interpret the transfer "(.*)"$/, (text: string) => {
      const parsed = aiParsedExpenseSchema.parse({
        amount: 100000, currency: null, type: 'transfer', category: null, payee: null,
        account: null, note: null, occurredAt: NOW, confidence: 1,
      });
      outcome = interpret(parsed, { accounts: ACCOUNTS, defaultAccountId: 'uob-one', now: NOW, text });
    });
  const thenRoute = (then: any) =>
    then(/^the transfer should go from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      expect(nameOf(draft().accountId)).toBe(from);
      expect(draft().transferAccountName).toBe(to);
    });
  const andCouldMean = (and: any) =>
    and(/^the card should say it could mean "(.*)"$/, (list: string) => {
      expect(draft().ambiguousAccountNames).toEqual(list.split(', '));
    });
  const andNotAmbiguous = (and: any) =>
    and('the card should not flag an ambiguous account', () => {
      expect(draft().ambiguousAccountNames).toBeUndefined();
    });
  const andGuess = (and: any) =>
    and('the source account should be marked as a guess', () => {
      expect(draft().defaulted.account).toBe(true);
    });
  const andNotGuess = (and: any) =>
    and('the source account should not be marked as a guess', () => {
      expect(draft().defaulted.account).toBe(false);
    });

  test('A partial source that fits two accounts is flagged on the card', ({ when, then, and }) => {
    whenInterpret(when); thenRoute(then); andCouldMean(and); andGuess(and);
  });
  test('A partial source that fits one account resolves', ({ when, then, and }) => {
    whenInterpret(when); thenRoute(then); andNotAmbiguous(and); andNotGuess(and);
  });
  test('A full name still wins outright', ({ when, then, and }) => {
    whenInterpret(when); thenRoute(then); andNotAmbiguous(and);
  });
  test('A partial destination that fits two accounts asks which', ({ when, then }) => {
    whenInterpret(when);
    then(/^the assistant should ask "(.*)"$/, (message: string) => {
      expect(outcome.kind).toBe('clarify');
      expect(outcome.kind === 'clarify' && outcome.message).toBe(message);
    });
  });
});
