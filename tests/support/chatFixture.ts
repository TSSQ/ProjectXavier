import type { NewChatMessage } from '../../src/domain/chatMessage';

const base = { dayKey: '2026-10-05', status: 'live' as const, dataRevision: 3, createdAt: 1_760_000_000_000 };
const user = (id: string) => ({ ...base, id, role: 'user' as const });
const xavier = (id: string) => ({ ...base, id, role: 'xavier' as const });
const result = { notes: [] as string[] };
const queryShared = { currency: 'SGD', caption: 'This month', comparison: null };

/** One valid message of every kind. */
export const CHAT_FIXTURES: NewChatMessage[] = [
  { ...user('m-user-text'), kind: 'user_text', payload: { text: 'coffee 4.50' } },
  { ...user('m-user-photo'), kind: 'user_photo', payload: { label: '📷 Receipt' } },
  { ...xavier('m-xavier-text'), kind: 'xavier_text', payload: { text: "No problem, I didn't save it." } },
  {
    ...xavier('m-receipt'),
    kind: 'xavier_receipt',
    payload: {
      headline: 'Saved SGD 18.00 to Transport.',
      amountText: 'SGD 18.00',
      amountTone: 'negative',
      lines: ['Today, Transport'],
      budget: { usedRatio: 0.4, state: 'ok', amountText: 'SGD 120', verb: 'left', where: 'in Transport this month' },
    },
  },
  {
    ...xavier('m-draft'),
    kind: 'draft',
    payload: {
      type: 'expense',
      amount: 1800,
      currency: 'SGD',
      accountName: 'Cash',
      toAccountName: null,
      categoryName: 'Transport',
      payeeName: 'Grab',
      note: null,
      occurredAt: 1_760_000_000_000,
      ambiguousAccountNames: ['Cash Wallet', 'Travel Wallet'],
    },
  },
  {
    ...xavier('m-acct-create'),
    kind: 'account_create',
    payload: { name: 'Trip', subtype: 'cash', openingBalance: 50_000, currency: 'SGD' },
  },
  {
    ...xavier('m-acct-update'),
    kind: 'account_update',
    payload: {
      accountId: 'a1',
      currentName: 'Cash',
      op: 'rename',
      newName: 'Wallet',
      newSubtype: null,
      newBalance: 12_000,
      balanceEdited: false,
      currency: 'SGD',
    },
  },
  {
    ...xavier('m-afford'),
    kind: 'afford',
    payload: {
      text: 'That fits.',
      scope: 'dining',
      categoryName: 'Dining',
      icon: '🍜',
      amount: 4000,
      month: '2026-10',
      currency: 'SGD',
      verdict: 'fits',
      leftNow: 20_000,
      after: 16_000,
      overall: null,
      view: { budget: 50_000, spent: 30_000, left: 20_000, state: 'ok' },
    },
  },
  {
    ...xavier('m-afford-pick'),
    kind: 'afford_pick',
    payload: {
      text: 'Which budget would this come from?',
      amount: 4000,
      currency: 'SGD',
      options: [{ categoryId: 'dining', name: 'Dining', icon: '🍜' }],
    },
  },
  {
    ...xavier('m-set-budget'),
    kind: 'set_budget',
    payload: { categoryName: 'Dining', change: 'set', text: 'Set Dining to SGD 500?', current: null, next: 50_000, currency: 'SGD' },
  },
  {
    ...xavier('m-delete'),
    kind: 'delete_handoff',
    payload: { accountId: 'a1', accountName: 'Cash', message: 'Deleting Cash affects 3 transactions.' },
  },
  {
    ...xavier('m-picker'),
    kind: 'tx_picker',
    payload: {
      op: 'delete',
      currency: 'SGD',
      rows: [
        {
          id: 't1',
          type: 'expense',
          amountMinor: 450,
          occurredAt: 1_760_000_000_000,
          payeeName: 'Kopi',
          categoryName: null,
          accountName: 'Cash',
        },
      ],
    },
  },
  {
    ...xavier('m-query-spent'),
    kind: 'query_answer',
    payload: { tool: 'total_spent', result: { ...result, amountMinor: 123_400, count: 12, resolvedCategory: 'Dining' }, ...queryShared },
  },
  {
    ...xavier('m-query-cat'),
    kind: 'query_answer',
    payload: {
      tool: 'spending_by_category',
      result: { ...result, slices: [{ categoryId: 'dining', name: 'Dining', amountMinor: 9000 }] },
      ...queryShared,
    },
  },
  {
    ...xavier('m-query-compare'),
    kind: 'query_answer',
    payload: {
      tool: 'total_spent',
      result: { ...result, amountMinor: 100, count: 1 },
      currency: 'SGD',
      caption: null,
      comparison: { tool: 'total_spent', title: 'Total spent', series: [{ label: '2025', amountMinor: 5 }, { label: '2026', amountMinor: 9 }] },
    },
  },
  {
    ...xavier('m-query-income'),
    kind: 'query_answer',
    payload: { tool: 'total_income', result: { ...result, amountMinor: 500_000, count: 2, resolvedCategory: 'Salary' }, ...queryShared },
  },
  {
    ...xavier('m-query-time'),
    kind: 'query_answer',
    payload: {
      tool: 'spending_over_time',
      result: { ...result, series: [{ label: 'Oct', amountMinor: 100 }, { label: 'Nov', amountMinor: 0 }], resolvedCategory: 'Dining' },
      ...queryShared,
    },
  },
  {
    ...xavier('m-query-payees'),
    kind: 'query_answer',
    payload: {
      tool: 'top_payees',
      result: { ...result, rows: [{ payeeId: 'p1', name: 'Grab', amountMinor: 900, count: 3 }, { payeeId: null, name: 'Other', amountMinor: 5, count: 1 }] },
      ...queryShared,
    },
  },
  {
    ...xavier('m-query-networth'),
    kind: 'query_answer',
    payload: { tool: 'net_worth', result: { ...result, amountMinor: -250_000 }, ...queryShared },
  },
  {
    ...xavier('m-query-networth-series'),
    kind: 'query_answer',
    payload: {
      tool: 'net_worth',
      result: { notes: ["Couldn't find that account, showing all."], series: [{ label: 'Jan', amountMinor: 1 }, { label: 'Feb', amountMinor: 2 }] },
      ...queryShared,
    },
  },
  {
    ...xavier('m-query-search'),
    kind: 'query_answer',
    payload: {
      tool: 'search_transactions',
      result: {
        ...result,
        resolvedPayee: 'Kopi',
        resolvedAccount: 'Cash',
        rows: [
          { id: 't1', type: 'expense', amountMinor: 450, occurredAt: 1_760_000_000_000, categoryName: 'Food', payeeName: 'Kopi', accountName: 'Cash', note: 'with friends' },
          { id: 't2', type: 'income', amountMinor: 1, occurredAt: 0, categoryName: null, payeeName: null, accountName: null, note: null },
        ],
      },
      ...queryShared,
    },
  },
  {
    ...xavier('m-statement'),
    kind: 'statement_queue',
    payload: { total: 8, saved: 5, skipped: 1, accountName: 'DBS Card' },
  },
];

/** A string no real message contains, for byte-level leak checks. */
export const CHAT_MARKER = 'CHATMARKER-7f3a9c-do-not-store';
