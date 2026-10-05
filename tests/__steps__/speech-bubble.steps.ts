import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ACCOUNT_UPDATE_CANCELLED_TEXT,
  BubbleContent,
  DISCARDED_TEXT,
  SAVED_FALLBACK,
  accountArchivedText,
  accountCreatedReceipt,
  accountUpdatedText,
  bubbleText,
  budgetSetReceipt,
  savedReceipt,
  seriesText,
  updatedReceipt,
} from '../../src/domain/bubbleCopy';
import { computeBudgets } from '../../src/domain/budgets';
import { RecurrenceRule, TransactionType } from '../../src/domain/types';
import { NOW, budgetRow, cat, expenseTx } from '../support/budgetFixture';

// Intl puts a no-break space between "SGD" and the digits; the feature writes a plain one.
const plain = (v: string | undefined) => v?.replace(/\u00a0/g, ' ');

const receiptOf = (c: BubbleContent) => {
  if (c.kind !== 'receipt') throw new Error('expected a receipt');
  return c;
};

const RULES: Record<string, RecurrenceRule | null> = {
  monthly: { freq: 'monthly', interval: 1 } as RecurrenceRule,
  '': null,
};

defineFeature(loadFeature(path.resolve(__dirname, '../__features__/speech-bubble.feature')), (test) => {
  let category = cat('c', 'Food', '🍔');
  let view: ReturnType<typeof computeBudgets>['categories'][number] | undefined;
  let content: BubbleContent;
  let text: string;

  const given = (name: string, budget: number | null, spent: number) => {
    category = cat('c', name, '🏷️');
    const txs = spent > 0 ? [expenseTx('c', spent, NOW, { currency: 'SGD' })] : [];
    const rows = budget === null ? [] : [budgetRow('c', budget, '2026-01')];
    const summary = computeBudgets({
      transactions: txs,
      series: [],
      categories: [category],
      rows,
      now: NOW,
      month: '2026-10',
    });
    view = summary.categories.find((v) => v.categoryId === 'c');
  };

  const save = (
    type: TransactionType,
    major: number,
    withCategory: boolean,
    account: string,
    extra: { payee?: string; to?: string } = {}
  ) => {
    content = savedReceipt({
      type,
      amount: major * 100,
      currency: 'SGD',
      occurredAt: NOW,
      now: NOW,
      payeeName: extra.payee ?? null,
      category: withCategory ? { name: category.name, icon: category.icon } : null,
      accountName: account,
      toAccountName: extra.to ?? null,
      budget:
        type === 'expense' && withCategory && view
          ? { topName: category.name, view, month: '2026-10', currency: 'SGD' }
          : null,
    });
  };

  // The outcome steps are shared by most scenarios: one dispatcher per Then/And
  // line (jest-cucumber wants exactly one definition per feature step).
  const ANY = /^(.*)$/;
  const check = (line: string) => {
    const m = (re: RegExp) => re.exec(line);
    let r: RegExpExecArray | null;
    if ((r = m(/^the receipt headline should be "(.*)"$/))) return expect(plain(receiptOf(content).headline)).toBe(r[1]);
    if ((r = m(/^the receipt line should be "(.*)"$/))) return expect(plain(receiptOf(content).lines[0])).toBe(r[1]);
    if ((r = m(/^the budget state should be "(.*)"$/))) return expect(receiptOf(content).budget?.state).toBe(r[1]);
    if ((r = m(/^the budget used share should be about ([\d.]+)$/)))
      return expect(receiptOf(content).budget?.usedRatio).toBeCloseTo(Number(r[1]), 2);
    if ((r = m(/^the budget used share should be (\d+)$/)))
      return expect(receiptOf(content).budget?.usedRatio).toBe(Number(r[1]));
    if ((r = m(/^the budget line should read "(.*)" then "(.*)"$/))) {
      expect(plain(receiptOf(content).budget?.amountText)).toBe(r[1]);
      return expect(`${receiptOf(content).budget?.verb} ${receiptOf(content).budget?.where}`).toBe(r[2]);
    }
    if (m(/^the receipt should have no budget$/)) return expect(receiptOf(content).budget).toBeUndefined();
    if ((r = m(/^the receipt amount should be coloured "(.*)"$/)))
      return expect(receiptOf(content).amountTone).toBe(r[1]);
    if ((r = m(/^the bubble text should be "(.*)"$/))) return expect(plain(text)).toBe(r[1]);
    throw new Error(`no check for: ${line}`);
  };
  const thenSteps = (then: any, and: any, count: number) => {
    then(ANY, check);
    for (let i = 1; i < count; i += 1) and(ANY, check);
  };

  test('A saved expense with a budget shows the receipt and what is left', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" budget of (\d+) SGD with (\d+) SGD already spent$/, (n: string, b: string, s: string) =>
      given(n, Number(b), Number(s))
    );
    when(/^I save a (\d+) SGD "(.*)" to "(.*)" from "(.*)"$/, (amt: string, type: string, _c: string, acct: string) =>
      save(type as TransactionType, Number(amt), true, acct)
    );
    thenSteps(then, and, 5);
  });

  test('An expense over budget is capped and says how far over', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" budget of (\d+) SGD with (\d+) SGD already spent$/, (n: string, b: string, s: string) =>
      given(n, Number(b), Number(s))
    );
    when(/^I save a (\d+) SGD "(.*)" to "(.*)" from "(.*)"$/, (amt: string, type: string, _c: string, acct: string) =>
      save(type as TransactionType, Number(amt), true, acct)
    );
    thenSteps(then, and, 3);
  });

  test('A category without a budget gets a receipt and no meter', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" category with no budget$/, (n: string) => given(n, null, 0));
    when(/^I save a (\d+) SGD "(.*)" to "(.*)" from "(.*)"$/, (amt: string, type: string, _c: string, acct: string) =>
      save(type as TransactionType, Number(amt), true, acct)
    );
    thenSteps(then, and, 2);
  });

  test('An expense with no category names the account', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" category with no budget$/, (n: string) => given(n, null, 0));
    when(/^I save a (\d+) SGD "(.*)" with no category from "(.*)"$/, (amt: string, type: string, acct: string) =>
      save(type as TransactionType, Number(amt), false, acct)
    );
    thenSteps(then, and, 2);
  });

  test('Income says where it came from and never shows an expense budget', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" budget of (\d+) SGD with (\d+) SGD already spent$/, (n: string, b: string, s: string) =>
      given(n, Number(b), Number(s))
    );
    when(
      /^I save a (\d+) SGD "(.*)" to "(.*)" from "(.*)" paid by "(.*)"$/,
      (amt: string, type: string, _c: string, acct: string, payee: string) =>
        save(type as TransactionType, Number(amt), true, acct, { payee })
    );
    thenSteps(then, and, 3);
  });

  test('A transfer names both accounts', ({ given: g, when, then, and }) => {
    g(/^a "(.*)" category with no budget$/, (n: string) => given(n, null, 0));
    when(/^I move (\d+) SGD from "(.*)" to "(.*)"$/, (amt: string, from: string, to: string) =>
      save('transfer', Number(amt), false, from, { to })
    );
    thenSteps(then, and, 2);
  });

  const seriesScenario = ({ when, then, and }: { when: any; then: any; and: any }) => {
    when(/^I save a (\d+) SGD series titled "(.*)" repeating "(.*)"$/, (amt: string, title: string, rule: string) => {
      text = seriesText({ title, amount: Number(amt) * 100, currency: 'SGD', rule: RULES[rule] });
    });
    thenSteps(then, and, 1);
  };
  test('A repeating series says it was set up', seriesScenario);
  test('A repeating series without a rule label still reads cleanly', seriesScenario);

  const budgetScenario = ({ when, then, and }: { when: any; then: any; and: any }) => {
    when(
      /^I set the "(.*)" budget to (\d+) USD from (.*) for "(.*)"$/,
      (name: string, next: string, prev: string, month: string) => {
        const m = /^(\d+) USD$/.exec(prev);
        content = budgetSetReceipt({
          categoryName: name,
          next: Number(next) * 100,
          previous: m ? Number(m[1]) * 100 : null,
          month,
          currency: 'USD',
        });
      }
    );
    thenSteps(then, and, 2);
  };
  test('A budget set in chat says what it is now and what it was', budgetScenario);
  test('A first budget has no previous amount', budgetScenario);

  test('Cancelled and discarded confirmations are plain', ({ then, and }) => {
    then(/^the discarded text should be "(.*)"$/, (want: string) => expect(DISCARDED_TEXT).toBe(want));
    and(/^the cancelled account update text should be "(.*)"$/, (want: string) =>
      expect(ACCOUNT_UPDATE_CANCELLED_TEXT).toBe(want)
    );
  });

  test('No confirmation asks "Anything else?"', ({ when, then }) => {
    const all: string[] = [];
    when(/^I build every confirmation$/, () => {
      given('Food', 30, 5);
      save('expense', 5, true, 'savings');
      all.push(bubbleText(content));
      save('income', 5, true, 'savings', { payee: 'Acme' });
      all.push(bubbleText(content));
      save('transfer', 5, false, 'savings', { to: 'Wallet' });
      all.push(bubbleText(content));
      all.push(seriesText({ title: 'Netflix', amount: 1500, currency: 'SGD', rule: RULES.monthly }));
      all.push(bubbleText(budgetSetReceipt({ categoryName: 'Food', next: 100, previous: 50, month: '2026-10', currency: 'USD' })));
      all.push(
        bubbleText(
          updatedReceipt({
            type: 'expense', amount: 100, currency: 'SGD', occurredAt: NOW, now: NOW,
            payeeName: 'Subway', category: { name: 'Dining', icon: '🍔' }, accountName: 'Wallet',
          })
        )
      );
      all.push(
        bubbleText(accountCreatedReceipt({ name: 'A', subtype: 'cash', openingBalance: 100, currency: 'SGD' })),
        accountUpdatedText({
          existing: { name: 'A', subtype: 'cash', openingBalance: 0, currency: 'SGD' },
          next: { name: 'B', subtype: 'cash', balance: 0, balanceEdited: false },
        }),
        accountArchivedText('A'),
        DISCARDED_TEXT,
        ACCOUNT_UPDATE_CANCELLED_TEXT,
        SAVED_FALLBACK
      );
    });
    then(/^none of them should contain "(.*)"$/, (phrase: string) => {
      expect(all.length).toBeGreaterThan(10);
      for (const line of all) expect(plain(line)).not.toContain(phrase);
    });
  });

  test('The saved-expense card is gone from the Assistant', ({ when, then }) => {
    let sources = '';
    when(/^I read the Assistant sources$/, () => {
      const root = path.resolve(__dirname, '../..');
      sources = [
        'app/(tabs)/index.tsx',
        'src/components/assistant/BudgetReplyActions.tsx',
        'src/features/budgets/useBudgetReplies.ts',
      ]
        .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
        .join('\n');
      expect(fs.existsSync(path.join(root, 'src/components/assistant/SavedBudgetCard.tsx'))).toBe(false);
    });
    then(/^nothing should render "(.*)"$/, (name: string) => {
      expect(sources).not.toContain(name);
    });
  });
});
