import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Transaction } from '../../src/domain/types';
import {
  interpret,
  buildTransaction,
  AssistantOutcome,
  TransactionDraft,
} from '../../src/domain/assistant';
import {
  aiParsedExpenseSchema,
  AiParsedExpense,
  transactionSchema,
} from '../../src/lib/validation';
import { makeAccount, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/ai-assistant.feature')
);

const NOW = Date.UTC(2026, 0, 1);

function makeParse(overrides: Partial<AiParsedExpense>): AiParsedExpense {
  return aiParsedExpenseSchema.parse({
    amount: null,
    currency: 'USD',
    type: null,
    category: null,
    payee: null,
    note: null,
    occurredAt: NOW,
    confidence: 1,
    ...overrides,
  });
}

defineFeature(feature, (test) => {
  let accounts: Account[];
  let parsed: AiParsedExpense;
  let outcome: AssistantOutcome;
  let tx: Transaction;

  const givenAsset = (given: any) =>
    given(/^an asset account "(.*)" with opening balance (.*)$/, (name: string, bal: string) => {
      accounts = [makeAccount({ name, type: 'asset', openingBalance: money(bal) })];
    });

  const givenNoAccounts = (given: any) =>
    given(/^there are no accounts$/, () => {
      accounts = [];
    });

  const givenFullParse = (and: any) =>
    and(
      /^the AI parses an expense of (.*) with type "(.*)" and confidence (.*)$/,
      (amt: string, type: string, conf: string) => {
        parsed = makeParse({
          amount: money(amt),
          type: type as AiParsedExpense['type'],
          confidence: parseFloat(conf),
        });
      }
    );

  const givenNoAmountParse = (and: any) =>
    and(/^the AI parses an expense with no amount and confidence (.*)$/, (conf: string) => {
      parsed = makeParse({ amount: null, type: 'expense', confidence: parseFloat(conf) });
    });

  const whenInterpret = (when: any) =>
    when(/^the assistant interprets the parse$/, () => {
      outcome = interpret(parsed, { accounts, now: NOW });
    });

  test('A confident, complete parse becomes a confirmable draft', ({ given, and, when, then }) => {
    givenAsset(given);
    givenFullParse(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    and(/^the draft amount should be (.*) on account "(.*)"$/, (amt: string) => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.amount).toBe(money(amt));
      expect(draft.accountId).toBe(accounts[0]!.id);
    });
  });

  test('A missing amount asks a clarifying question', ({ given, and, when, then }) => {
    givenAsset(given);
    givenNoAmountParse(and);
    whenInterpret(when);
    then(/^it should ask a clarifying question about "(.*)"$/, (field: string) => {
      expect(outcome.kind).toBe('clarify');
      expect((outcome as Extract<AssistantOutcome, { kind: 'clarify' }>).missing).toContain(field);
    });
  });

  test('Low confidence asks for more detail', ({ given, and, when, then }) => {
    givenAsset(given);
    givenFullParse(and);
    whenInterpret(when);
    then(/^it should ask a clarifying question$/, () => {
      expect(outcome.kind).toBe('clarify');
    });
  });

  test('No account blocks with guidance', ({ given, and, when, then }) => {
    givenNoAccounts(given);
    givenFullParse(and);
    whenInterpret(when);
    then(/^it should be blocked$/, () => {
      expect(outcome.kind).toBe('blocked');
    });
  });

  test('A confirmed draft builds a valid transaction', ({ given, and, when, then }) => {
    givenAsset(given);
    givenFullParse(and);
    whenInterpret(when);
    and(/^the draft is built into a transaction$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft as TransactionDraft;
      tx = buildTransaction(draft, {
        id: 'tx-1',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });
    then(/^the transaction should pass validation$/, () => {
      expect(transactionSchema.safeParse(tx).success).toBe(true);
    });
    and(/^the transaction source should be "(.*)"$/, (source: string) => {
      expect(tx.source).toBe(source);
    });
  });
});
