import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  accountCreateCard,
  accountUpdateCard,
  bubbleBody,
  budgetCard,
  BudgetCardInput,
  deleteHandoffCard,
  draftCard,
  photoBody,
  queryAnswerCard,
  queueRowReceipt,
  statementQueueCard,
  txPickerCard,
} from '../../src/domain/chatRecord';
import { CardBody } from '../../src/domain/chatLog';
import type { CategoryBudget } from '../../src/domain/budgets';
import { parseNewChatMessage } from '../../src/domain/chatMessage';
import { savedReceipt, textBubble } from '../../src/domain/bubbleCopy';
import { startQueue } from '../../src/domain/draftQueue';
import type { TransactionDraft } from '../../src/domain/assistant';
import type { Account, Category, Payee, Transaction } from '../../src/domain/types';
import { CHAT_FIXTURES } from '../support/chatFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-record.feature'));

const accounts = [
  { id: 'a1', name: 'Cash', currency: 'SGD', openingBalance: 0, archived: false },
  { id: 'a2', name: 'DBS Card', currency: 'SGD', openingBalance: 0, archived: false },
] as Account[];
const categories = [{ id: 'c1', name: 'Transport', kind: 'expense' }] as Category[];
const payees = [{ id: 'p1', name: 'Grab' }] as Payee[];
const NOW = new Date(2026, 9, 5, 12, 0).getTime();

const draft = (patch: Partial<TransactionDraft> = {}): TransactionDraft =>
  ({
    accountId: 'a1',
    type: 'expense',
    amount: 1800,
    currency: 'SGD',
    categoryName: 'Transport',
    payeeName: 'Grab',
    note: null,
    occurredAt: NOW,
    source: 'ai',
    defaulted: { account: false, payee: false, category: false, date: false },
    ...patch,
  }) as TransactionDraft;

const plan = {
  kind: 'answer' as const,
  text: 'That fits.',
  scope: 'c1',
  categoryName: 'Transport',
  icon: '🚌',
  result: { verdict: 'over' as const, leftNow: 1000, after: -500, overallLeftAfter: 3000 },
  view: { categoryId: 'c1', budget: 5000, spent: 4000, scheduled: 0, committed: 4000, left: 1000, fixed: 0, target: null, state: 'warn' as const, ratio: 0.8 } as unknown as CategoryBudget,
  amount: 1500,
  month: '2026-10',
  overall: 'All budgets together would still have SGD 30 left.',
};

const cards: Record<string, () => CardBody | null> = {
  draft: () => draftCard(draft({ ambiguousAccountNames: ['Cash', 'DBS Card'] }), accounts),
  'transfer draft': () => draftCard(draft({ type: 'transfer', transferAccountId: 'a2', transferAccountName: 'DBS Card' }), accounts),
  'account create': () => accountCreateCard({ name: 'Trip', subtype: 'cash', openingBalance: 5000 }, 'SGD'),
  'account update': () =>
    accountUpdateCard(
      { accountId: 'a1', currentName: 'Cash', op: 'rename', newName: 'Wallet', newBalance: 100, balanceEdited: false },
      'SGD'
    ),
  'delete handoff': () => deleteHandoffCard({ accountId: 'a1', accountName: 'Cash' }, 'Deleting Cash affects 3 transactions.'),
  'tx picker': () =>
    txPickerCard(
      {
        op: 'delete',
        candidates: [
          { id: 't1', type: 'expense', amount: 450, occurredAt: NOW, payeeId: 'p1', categoryId: 'c1', accountId: 'a1' },
        ] as Transaction[],
      },
      { accounts, categories, payees },
      'SGD'
    ),
  'statement queue': () => statementQueueCard(startQueue([draft(), draft({ accountId: 'a2' })]), accounts),
};
const budget = (reply: BudgetCardInput) => () => budgetCard(reply, { currency: 'SGD', text: 'Set Transport to SGD 50?' });
cards['afford'] = budget({ kind: 'afford', plan });
cards['afford pick'] = budget({
  kind: 'afford-pick',
  intent: { kind: 'afford', amount: 15, subject: 'a 15 lunch' },
  options: [{ categoryId: 'c1', name: 'Transport', icon: '🚌' }],
});
cards['set budget'] = budget({ kind: 'set-budget', category: { name: 'Transport' }, current: null, next: 5000, currency: 'SGD' });
cards['set budget (edit)'] = budget({ kind: 'set-budget', category: { name: 'Transport' }, current: 4000, next: 5000, currency: 'SGD' });
cards['remove budget'] = budget({ kind: 'remove-budget', category: { name: 'Transport' }, current: 4000, currency: 'SGD' });
cards['create category'] = budget({ kind: 'create-category', name: 'Pets', next: 30000, currency: 'SGD' });
cards['suggest set'] = budget({ kind: 'set-budget-suggest', category: { name: 'Dining' }, action: { kind: 'set', amount: 500 }, currency: 'SGD' });
cards['suggest edit by'] = budget({
  kind: 'set-budget-suggest',
  category: { name: 'Dining' },
  action: { kind: 'edit-by', direction: 'raise', amount: 500 },
  currency: 'SGD',
});
cards['suggest remove'] = budget({ kind: 'set-budget-suggest', category: { name: 'Dining' }, action: { kind: 'remove' }, currency: 'SGD' });

/** A full message built from a mapped body, validated like the repository does. */
const validate = (body: { kind: string; payload: unknown }) =>
  parseNewChatMessage({
    id: 'm1',
    dayKey: '2026-10-05',
    role: body.kind.startsWith('user') ? 'user' : 'xavier',
    kind: body.kind,
    payload: body.payload,
    status: 'live',
    dataRevision: 1,
    createdAt: NOW,
  });

defineFeature(feature, (test) => {
  test('Each card kind maps to a schema-valid message', ({ then }) => {
    then(/^the "(.*)" mapping should pass the chat message schema as kind "(.*)"$/, (name: string, kind: string) => {
      const body = cards[name]!();
      expect(body).not.toBeNull();
      expect(validate(body!).kind).toBe(kind);
    });
  });

  test("Every query tool's answer maps to a schema-valid message", ({ then }) => {
    then(/^the "(.*)" answer should pass the chat message schema$/, (tool: string) => {
      const fixture = CHAT_FIXTURES.find((m) => m.kind === 'query_answer' && m.payload.tool === tool)!;
      const p = fixture.payload as { result: unknown; caption: string | null };
      const body = queryAnswerCard(
        { tool: tool as never, result: p.result, caption: p.caption, comparison: null },
        'SGD'
      );
      expect(validate(body).kind).toBe('query_answer');
    });
  });

  test('Bubbles map to text and receipts', ({ then }) => {
    then('a text bubble, a saved receipt and a budget receipt all pass the schema, and a logged receipt is marked', () => {
      expect(validate(bubbleBody(textBubble('Hi'))).kind).toBe('xavier_text');
      const saved = savedReceipt({
        type: 'expense',
        amount: 1800,
        currency: 'SGD',
        occurredAt: NOW,
        now: NOW,
        payeeName: 'Grab',
        category: { name: 'Transport', icon: '🚌' },
        accountName: 'Cash',
        budget: {
          topName: 'Transport',
          month: '2026-10',
          currency: 'SGD',
          view: { categoryId: 'c1', budget: 5000, spent: 1800, scheduled: 0, committed: 1800, left: 3200, fixed: 0, target: null, state: 'ok', ratio: 0.3 } as unknown as CategoryBudget,
        },
      });
      const body = bubbleBody(saved, { logged: true });
      expect(validate(body).kind).toBe('xavier_receipt');
      expect((body.payload as { logged?: boolean }).logged).toBe(true);
      expect((bubbleBody(saved).payload as { logged?: boolean }).logged).toBeUndefined();
    });
  });

  test('A statement row receipt counts as logged', ({ then }) => {
    then('the queue row receipt passes the schema and is marked logged', () => {
      const body = bubbleBody(queueRowReceipt(draft(), accounts, NOW), { logged: true });
      expect(validate(body).kind).toBe('xavier_receipt');
      expect((body.payload as { logged?: boolean }).logged).toBe(true);
    });
  });

  test('A photo records its label and nothing else', ({ then }) => {
    then('the photo body holds only a label', () => {
      const body = photoBody('📷 Receipt');
      expect(body).toEqual({ kind: 'user_photo', payload: { label: '📷 Receipt' } });
      expect(validate(body).kind).toBe('user_photo');
    });
  });

  test('State that cannot fill a payload is skipped', ({ then }) => {
    then('a draft on an unknown account, "Open Budget" and "no budgets yet" map to nothing', () => {
      expect(draftCard(draft({ accountId: 'gone' }), accounts)).toBeNull();
      expect(budgetCard({ kind: 'budget-unknown' }, { currency: 'SGD', text: '' })).toBeNull();
      expect(budgetCard({ kind: 'no-budgets' }, { currency: 'SGD', text: '' })).toBeNull();
    });
  });

  test('An invalid query result is refused by the schema, not stored', ({ then }) => {
    then('a query answer whose result has the wrong shape fails the chat message schema', () => {
      const body = queryAnswerCard({ tool: 'total_spent', result: { amountMinor: 'lots' }, caption: null, comparison: null }, 'SGD');
      expect(() => validate(body)).toThrow('chat_invalid_write');
    });
  });
});
