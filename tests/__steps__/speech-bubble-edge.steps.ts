import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  BubbleContent,
  accountUpdatedText,
  bubbleText,
  deletedManyText,
  deletedText,
  savedReceipt,
  seriesText,
  shouldApplyReceipt,
  textBubble,
  updatedReceiptFor,
} from '../../src/domain/bubbleCopy';
import { CategoryBudget, computeBudgets } from '../../src/domain/budgets';
import { RecurrenceRule } from '../../src/domain/types';
import { budgetRow, cat, expenseTx, local, NOW } from '../support/budgetFixture';

// Intl puts a no-break space after the currency code; the feature writes a plain one.
const plain = (v: string | undefined) => v?.replace(/\u00a0/g, ' ');

const RULES: Record<string, RecurrenceRule> = {
  'every 2 weeks': { freq: 'weekly', interval: 2 } as RecurrenceRule,
  yearly: { freq: 'yearly', interval: 1 } as RecurrenceRule,
  'every 2 years': { freq: 'yearly', interval: 2 } as RecurrenceRule,
  'semi-annually': { freq: 'monthly', interval: 6 } as RecurrenceRule,
  custom: { freq: 'custom', interval: 1 } as unknown as RecurrenceRule,
};

const feature = loadFeature(path.resolve(__dirname, '../__features__/speech-bubble-edge.feature'));

defineFeature(feature, (test) => {
  const category = (name: string) => cat('c', name, '🏷️');
  let view: CategoryBudget | undefined;
  let month = '2026-10';
  let content: BubbleContent;
  let text = '';
  let existing = { name: '', subtype: '', openingBalance: 0, currency: 'SGD' };
  let sources = '';

  const receiptOf = () => {
    if (content.kind !== 'receipt') throw new Error('expected a receipt');
    return content;
  };

  const givenBudget = (n: string, budget: string, spent: string, m: string) => {
    month = m;
    const [y = 0, mo = 0] = m.split('-').map(Number);
    const summary = computeBudgets({
      transactions: [expenseTx('c', Number(spent), local(y, mo, 5), { currency: 'SGD' })],
      series: [],
      categories: [category(n)],
      rows: [budgetRow('c', Number(budget), '2026-01')],
      now: NOW,
      month: m,
    });
    view = summary.categories.find((v) => v.categoryId === 'c');
  };
  const saveExpense = (amt: string, currency: string, n: string, date: string) => {
    const [y = 0, mo = 0, d = 0] = date.split('-').map(Number);
    content = savedReceipt({
      type: 'expense',
      amount: Number(amt) * 100,
      currency,
      occurredAt: local(y, mo, d),
      now: NOW,
      payeeName: null,
      category: { name: n, icon: '🏷️' },
      accountName: 'savings',
      budget: view ? { topName: n, view, month, currency: 'SGD' } : null,
    });
  };
  const savedFood = (withBudget: boolean) =>
    savedReceipt({
      type: 'expense',
      amount: 500,
      currency: 'SGD',
      occurredAt: NOW,
      now: NOW,
      payeeName: null,
      category: { name: 'Food', icon: '🏷️' },
      accountName: 'savings',
      budget: withBudget
        ? {
            topName: 'Food',
            view: { budget: 3000, committed: 500, left: 2500, state: 'ok' } as CategoryBudget,
            month: '2026-10',
            currency: 'SGD',
          }
        : null,
    });

  // One dispatcher per step: jest-cucumber wants exactly one definition per feature line.
  const ANY = /^(.*)$/;
  const run = (line: string) => {
    let groups: string[] = [];
    const a = (i: number) => groups[i] as string;
    const m = (re: RegExp) => {
      const x = re.exec(line);
      if (x) groups = x as string[];
      return x !== null;
    };
    if (m(/^a "(.*)" budget of (\d+) SGD with (\d+) SGD already spent in "(.*)"$/))
      return givenBudget(a(1), a(2), a(3), a(4));
    if (m(/^I save a (\d+) (\w+) expense to "(.*)" on "(.*)"$/))
      return saveExpense(a(1), a(2), a(3), a(4));
    if (m(/^a budget view of 0 with 5 committed$/))
      return void (view = { budget: 0, committed: 500, left: -500, state: 'over' } as CategoryBudget);
    if (m(/^I build the receipt for it$/)) return saveExpense('5', 'SGD', 'Food', '2026-10-18');
    if (m(/^the account "(.*)" of kind "(.*)" with balance (\d+) (\w+)$/))
      return void (existing = { name: a(1), subtype: a(2), openingBalance: Number(a(3)) * 100, currency: a(4) });
    if (m(/^I set its balance to (\d+)$/))
      return void (text = accountUpdatedText({
        existing,
        next: { name: existing.name, subtype: existing.subtype, balance: Number(a(1)) * 100, balanceEdited: true },
      }));
    if (m(/^I update a "(.*)" expense of (\d+) SGD in category "(.*)" on account "(.*)"$/)) {
      content = updatedReceiptFor({
        tx: { type: 'expense', amount: Number(a(2)) * 100, currency: 'SGD', occurredAt: NOW, accountId: 'w' },
        payeeName: a(1),
        categoryName: a(3),
        categories: [{ name: 'Dining', icon: '🍔' }],
        accounts: [{ id: 'w', name: a(4) }],
        now: NOW,
      });
      return;
    }
    if (m(/^the receipt line should be "(.*)"$/)) return expect(plain(receiptOf().lines[0])).toBe(a(1));
    if (m(/^I retype it to "(.*)"$/))
      return void (text = accountUpdatedText({
        existing,
        next: { name: existing.name, subtype: a(1), balance: existing.openingBalance, balanceEdited: false },
      }));
    if (m(/^I set up a repeating series with "(.*)"$/))
      return void (text = seriesText({ title: 'Netflix', amount: 1500, currency: 'SGD', rule: RULES[a(1)] }));
    if (m(/^the bubble text should be "(.*)"$/)) return expect(plain(text)).toBe(a(1));
    if (m(/^the budget state should be "(.*)"$/)) return expect(receiptOf().budget?.state).toBe(a(1));
    if (m(/^the budget used share should be (\d+)$/)) {
      const ratio = receiptOf().budget?.usedRatio as number;
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
      return expect(ratio).toBe(Number(a(1)));
    }
    if (m(/^the budget line should read "(.*)" then "(.*)"$/)) {
      expect(plain(receiptOf().budget?.amountText)).toBe(a(1));
      return expect(`${receiptOf().budget?.verb} ${receiptOf().budget?.where}`).toBe(a(2));
    }
    if (m(/^the receipt headline should be "(.*)"$/)) return expect(plain(receiptOf().headline)).toBe(a(1));
    if (m(/^the label of a text bubble "(.*)" should be "(.*)"$/))
      return expect(bubbleText(textBubble(a(1)))).toBe(a(2));
    if (m(/^the label of a plain line bubble "(.*)" should be "(.*)"$/))
      return expect(bubbleText(textBubble(a(1)))).toBe(a(2));
    if (m(/^the label of the saved Food receipt should be "(.*)"$/))
      return expect(plain(bubbleText(savedFood(true)))).toBe(a(1));
    if (m(/^the label of the saved Food receipt without a budget should be "(.*)"$/))
      return expect(plain(bubbleText(savedFood(false)))).toBe(a(1));
    if (m(/^deleting one should read "(.*)"$/)) return expect(deletedText()).toBe(a(1));
    if (m(/^deleting one transfer with "(.*)" should read "(.*)"$/))
      return expect(deletedText(a(1))).toBe(a(2));
    if (m(/^deleting (\d+) should read "(.*)"$/)) return expect(deletedManyText(Number(a(1)), [])).toBe(a(2));
    if (m(/^deleting (\d+) with "(.*)" should read "(.*)"$/))
      return expect(deletedManyText(Number(a(1)), a(2).split(', '))).toBe(a(3));
    if (m(/^a receipt started at stamp (\d+) should apply at stamp (\d+)$/))
      return expect(shouldApplyReceipt(Number(a(1)), Number(a(2)))).toBe(true);
    if (m(/^a receipt started at stamp (\d+) should not apply at stamp (\d+)$/))
      return expect(shouldApplyReceipt(Number(a(1)), Number(a(2)))).toBe(false);
    if (m(/^I read the Assistant sources$/)) {
      const root = path.resolve(__dirname, '../..');
      return void (sources = [
        'app/(tabs)/index.tsx',
        'src/features/budgets/useBudgetReplies.ts',
        'src/domain/bubbleCopy.ts',
      ]
        .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
        .join('\n'));
    }
    if (m(/^none of the sources should contain "(.*)"$/)) return expect(sources).not.toContain(a(1));
    throw new Error(`no step for: ${line}`);
  };

  type Fn = (re: RegExp, f: (line: string) => void) => void;
  // [givens, whens, thens] - the first of each group uses its keyword, the rest `and`.
  const scenario = (g: number, w: number, t: number) => (k: { given: Fn; when: Fn; then: Fn; and: Fn }) => {
    const groups: [Fn, number][] = [[k.given, g], [k.when, w], [k.then, t]];
    for (const [kw, n] of groups) {
      for (let i = 0; i < n; i += 1) (i === 0 ? kw : k.and)(ANY, run);
    }
  };

  test('A warn-state budget colours the meter warn', scenario(1, 1, 1));
  test('Spending exactly the budget leaves zero and a full meter', scenario(1, 1, 2));
  test('A save in another month names that month', scenario(1, 1, 1));
  test('A foreign-currency expense keeps its own currency in the headline', scenario(1, 1, 2));
  test('A zero budget keeps the meter within bounds', scenario(1, 1, 1));
  test('A retype reads as a sentence with the right article', scenario(1, 1, 1));
  test('A bank account retyped to cash', scenario(1, 1, 1));
  test("A balance change is shown in the account's own currency", scenario(1, 1, 1));
  test('A transaction update names what it changed', scenario(0, 1, 2));
  test('A category with no icon falls back to the tag emoji', scenario(0, 1, 1));
  test('Retyping to the same kind in a different case changes nothing', scenario(1, 1, 1));
  test('A kind already ending in account is not doubled', scenario(1, 1, 1));
  test('A repeat label reads naturally', scenario(0, 1, 1));
  test('The accessibility label reads the whole bubble with exact punctuation', scenario(0, 0, 4));
  test('Delete confirmations say what happened', scenario(0, 0, 6));
  test('A late receipt never overwrites something newer', scenario(0, 0, 2));
  test('No source file asks "Anything else?"', scenario(0, 1, 1));
});
