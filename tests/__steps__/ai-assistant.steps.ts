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
// Mirrors the accepted-date window in interpret() (src/domain/assistant.ts) so
// boundary scenarios stay deterministic without importing internals.
const TWO_YEARS = 2 * 365 * 24 * 60 * 60 * 1000;

function makeParse(overrides: Partial<AiParsedExpense>): AiParsedExpense {
  return aiParsedExpenseSchema.parse({
    amount: null,
    currency: 'USD',
    type: null,
    category: null,
    payee: null,
    account: null,
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
  let defaultAccountId: string | undefined;
  let userText: string | undefined;

  const givenAsset = (given: any) =>
    given(/^an asset account "(.*)" with opening balance (.*)$/, (name: string, bal: string) => {
      accounts = [makeAccount({ name, openingBalance: money(bal) })];
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

  const andAsset = (and: any) =>
    and(/^an asset account "(.*)" with opening balance (.*)$/, (name: string, bal: string) => {
      accounts.push(makeAccount({ name, openingBalance: money(bal) }));
    });

  const givenParseOnAccount = (and: any) =>
    and(
      /^the AI parses an expense of (.*) with type "(.*)" on account "(.*)" and confidence (.*)$/,
      (amt: string, type: string, account: string, conf: string) => {
        parsed = makeParse({
          amount: money(amt),
          type: type as AiParsedExpense['type'],
          account,
          confidence: parseFloat(conf),
        });
      }
    );

  const thenDraftAccount = (and: any) =>
    and(/^the draft should use account "(.*)"$/, (name: string) => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      const acct = accounts.find((a) => a.name === name);
      expect(draft.accountId).toBe(acct!.id);
    });

  const whenInterpret = (when: any) =>
    when(/^the assistant interprets the parse$/, () => {
      outcome = interpret(parsed, { accounts, now: NOW });
    });

  const andNoAccountPayeeCategoryDate = (and: any) =>
    and(/^the parse has no account, payee, category, or date$/, () => {
      parsed = aiParsedExpenseSchema.parse({
        ...parsed,
        account: null,
        payee: null,
        category: null,
        occurredAt: null,
      });
    });

  const andNamesPayeeAndCategory = (and: any) =>
    and(/^the parse names a payee "(.*)" and category "(.*)"$/, (payee: string, category: string) => {
      parsed = aiParsedExpenseSchema.parse({ ...parsed, payee, category });
    });

  const andNamesPayeeOnly = (and: any) =>
    and(/^the parse names a payee "(.*)"$/, (payee: string) => {
      parsed = aiParsedExpenseSchema.parse({ ...parsed, payee });
    });

  const givenParseAtDateOffset = (and: any) =>
    and(
      /^the AI parses an expense of (.*) with type "(.*)" occurring (exactly 2 years ago|just over 2 years ago) and confidence (.*)$/,
      (amt: string, type: string, when: string, conf: string) => {
        const occurredAt =
          when === 'exactly 2 years ago' ? NOW - TWO_YEARS : NOW - TWO_YEARS - 1;
        parsed = makeParse({
          amount: money(amt),
          type: type as AiParsedExpense['type'],
          confidence: parseFloat(conf),
          occurredAt,
        });
      }
    );

  const thenAllDefaulted = (and: any) =>
    and(/^every draft field should be marked as defaulted$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.defaulted).toEqual({
        account: true,
        payee: true,
        category: true,
        date: true,
      });
    });

  const thenNoneDefaulted = (and: any) =>
    and(/^no draft field should be marked as defaulted$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.defaulted).toEqual({
        account: false,
        payee: false,
        category: false,
        date: false,
      });
    });

  const thenDraftAccountDefaulted = (and: any) =>
    and(/^the draft account should be marked as defaulted$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.defaulted.account).toBe(true);
    });

  const thenUnmatchedAccountName = (and: any) =>
    and(/^the unmatched account name should be "(.*)"$/, (name: string) => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.unmatchedAccountName).toBe(name);
    });

  const thenDefaultedFlagsEqual = (and: any) =>
    and(
      /^the draft defaulted flags should be account (true|false), payee (true|false), category (true|false), and date (true|false)$/,
      (account: string, payee: string, category: string, date: string) => {
        const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
        expect(draft.defaulted).toEqual({
          account: account === 'true',
          payee: payee === 'true',
          category: category === 'true',
          date: date === 'true',
        });
      }
    );

  const thenDraftDateNotDefaulted = (and: any) =>
    and(/^the draft date should not be marked as defaulted$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.defaulted.date).toBe(false);
    });

  const thenDraftDateDefaulted = (and: any) =>
    and(/^the draft date should be marked as defaulted$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.defaulted.date).toBe(true);
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

  test('The assistant uses the account the AI named', ({ given, and, when, then }) => {
    givenAsset(given);
    andAsset(and);
    givenParseOnAccount(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftAccount(and);
  });

  test('An unrecognised account name falls back to the first account', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenParseOnAccount(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftAccount(and);
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

  test('A sparse parse flags account, payee, category, and date as defaulted', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenFullParse(and);
    andNoAccountPayeeCategoryDate(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenAllDefaulted(and);
  });

  test('A fully specified parse has no defaulted fields', ({ given, and, when, then }) => {
    givenAsset(given);
    givenParseOnAccount(and);
    andNamesPayeeAndCategory(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenNoneDefaulted(and);
  });

  test('A named but unmatched account is flagged as defaulted', ({ given, and, when, then }) => {
    givenAsset(given);
    givenParseOnAccount(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftAccountDefaulted(and);
    thenUnmatchedAccountName(and);
  });

  test('The four defaulted flags are computed independently', ({ given, and, when, then }) => {
    givenAsset(given);
    givenFullParse(and);
    andNamesPayeeOnly(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDefaultedFlagsEqual(and);
  });

  test('A date exactly 2 years old is still within the accepted window', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenParseAtDateOffset(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftDateNotDefaulted(and);
  });

  test('A date just over 2 years old falls outside the accepted window', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenParseAtDateOffset(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftDateDefaulted(and);
  });

  // ─── Transfers ────────────────────────────────────────────────────────────
  // The destination/source accounts come from the user's own text
  // (resolveTransferAccounts), never the model's `account` field, so these
  // scenarios set `defaultAccountId` and pass `text` on the ctx alongside a
  // transfer-typed parse.

  const givenDefaultAccount = (and: any) =>
    and(/^"(.*)" is the default account$/, (name: string) => {
      defaultAccountId = accounts.find((a) => a.name === name)?.id;
    });

  const givenTransferParse = (and: any) =>
    and(
      /^the AI parses a transfer of (.*) and confidence (.*)$/,
      (amt: string, conf: string) => {
        parsed = makeParse({
          amount: money(amt),
          type: 'transfer',
          confidence: parseFloat(conf),
        });
      }
    );

  const givenUserSaid = (and: any) =>
    and(/^the user said "(.*)"$/, (text: string) => {
      userText = text;
    });

  const whenInterpretTransfer = (when: any) =>
    when(/^the assistant interprets the parse$/, () => {
      outcome = interpret(parsed, {
        accounts,
        now: NOW,
        defaultAccountId,
        text: userText,
      });
    });

  const thenDraftTransferFromTo = (and: any) =>
    and(
      /^the draft should transfer from "(.*)" to "(.*)"$/,
      (fromName: string, toName: string) => {
        const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
        const fromAcct = accounts.find((a) => a.name === fromName);
        const toAcct = accounts.find((a) => a.name === toName);
        expect(draft.accountId).toBe(fromAcct!.id);
        expect(draft.transferAccountId).toBe(toAcct!.id);
        expect(draft.transferAccountName).toBe(toName);
      }
    );

  const thenDraftPayeeCategoryNull = (and: any) =>
    and(/^the draft payee and category should be null$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.payeeName).toBeNull();
      expect(draft.categoryName).toBeNull();
    });

  const thenConfirmMessage = (and: any) =>
    and(/^the confirm message should be "(.*)"$/, (message: string) => {
      expect(outcome.kind).toBe('confirm');
      expect((outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).message).toBe(
        message
      );
    });

  const thenClarifyMessage = (and: any) =>
    and(/^the clarifying message should be "(.*)"$/, (message: string) => {
      expect((outcome as Extract<AssistantOutcome, { kind: 'clarify' }>).message).toBe(
        message
      );
    });

  const thenBlockMessage = (and: any) =>
    and(/^the block message should be "(.*)"$/, (message: string) => {
      expect((outcome as Extract<AssistantOutcome, { kind: 'blocked' }>).message).toBe(
        message
      );
    });

  const thenTransferSourceDestinationDiffer = (and: any) =>
    and(/^the draft transfer source and destination should be different accounts$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.accountId).not.toBe(draft.transferAccountId);
    });

  const thenDraftAmountPositive = (then: any) =>
    then(/^the draft amount should be positive$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.amount).toBeGreaterThan(0);
    });

  test('A transfer resolves the default account as source and the named account as destination', ({
    given,
    and,
    when,
    then,
  }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    givenDefaultAccount(and);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftTransferFromTo(and);
    thenDraftPayeeCategoryNull(and);
    thenConfirmMessage(and);
  });

  test('"from X to Y" overrides the source account', ({ given, and, when, then }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    andAsset(and);
    givenDefaultAccount(and);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenDraftTransferFromTo(and);
  });

  test('A transfer with no destination named asks the pinned clarifying question', ({
    given,
    and,
    when,
    then,
  }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should ask a clarifying question$/, () => {
      expect(outcome.kind).toBe('clarify');
    });
    thenClarifyMessage(and);
  });

  test('A transfer with only the destination account existing is blocked', ({
    given,
    and,
    when,
    then,
  }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should be blocked$/, () => {
      expect(outcome.kind).toBe('blocked');
    });
    thenBlockMessage(and);
  });

  test('The transfer source can never resolve to the same account as the destination', ({
    given,
    and,
    when,
    then,
  }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    thenTransferSourceDestinationDiffer(and);
  });

  test("A transfer's draft amount is a positive magnitude", ({ given, and, when, then }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    givenTransferParse(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    thenDraftAmountPositive(then);
  });

  const andParseFlaggedPending = (and: any) =>
    and(/^the parse is flagged pending$/, () => {
      parsed = aiParsedExpenseSchema.parse({ ...parsed, pending: true });
    });

  test("A pending-flagged parse pre-sets the draft's pending flag", ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenFullParse(and);
    andParseFlaggedPending(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    and(/^the draft should be pending$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.pending).toBe(true);
    });
  });

  test('A parse with no pending flag leaves the draft not pending', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenFullParse(and);
    whenInterpret(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    and(/^the draft should not be pending$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.pending ?? false).toBe(false);
    });
  });

  test('A confirmed pending draft builds a transaction that starts pending', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAsset(given);
    givenFullParse(and);
    andParseFlaggedPending(and);
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
    and(/^the transaction should be pending$/, () => {
      expect(tx.pending).toBe(true);
    });
  });

  test("A pending-flagged transfer parse pre-sets the draft's pending flag", ({
    given,
    and,
    when,
    then,
  }) => {
    defaultAccountId = undefined;
    userText = undefined;
    givenAsset(given);
    andAsset(and);
    givenDefaultAccount(and);
    givenTransferParse(and);
    andParseFlaggedPending(and);
    givenUserSaid(and);
    whenInterpretTransfer(when);
    then(/^it should offer a draft to confirm$/, () => {
      expect(outcome.kind).toBe('confirm');
    });
    and(/^the draft should be pending$/, () => {
      const draft = (outcome as Extract<AssistantOutcome, { kind: 'confirm' }>).draft;
      expect(draft.pending).toBe(true);
    });
  });
});
