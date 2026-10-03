import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, Payee, RecurringSeries, Transaction } from '../../src/domain/types';
import { BudgetSummary, computeBudgets, affordAnswer, AffordResult } from '../../src/domain/budgets';
import { affordLogText, detectBudgetIntent, stripAffordCue, AffordIntent } from '../../src/domain/budgetIntent';
import { AffordPlan, inferAffordCategory, planAfford, presetCategoryName } from '../../src/domain/affordPlan';
import { affordReply, overallLine } from '../../src/domain/budgetCopy';
import { cueRefusal } from '../../src/domain/notTransactionCues';
import {
  FIXTURE_BUDGETS,
  FIXTURE_CATEGORIES,
  NOW,
  budgetRow,
  expenseTx,
  local,
  mockupFixture,
} from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-afford.feature'));

defineFeature(feature, (test) => {
  let transactions: Transaction[] = [];
  let series: RecurringSeries[] = [];
  let rows = FIXTURE_BUDGETS;
  let now = NOW;
  let payees: Payee[] = [];
  let summary: BudgetSummary;
  let result: AffordResult | null = null;
  let reply = '';
  let plan: AffordPlan | null = null;
  let amountMinor = 0;

  beforeEach(() => {
    transactions = [];
    series = [];
    rows = FIXTURE_BUDGETS;
    now = NOW;
    payees = [];
    result = null;
    reply = '';
    plan = null;
  });

  const categories: Category[] = FIXTURE_CATEGORIES;
  const compute = () => {
    summary = computeBudgets({ transactions, series, categories, rows, now, month: '2026-10' });
  };
  const idOf = (name: string) => categories.find((c) => c.name === name)!.id;
  const givenMockup = () => {
    const f = mockupFixture();
    transactions = f.transactions;
    series = f.series;
    compute();
  };
  const ctx = () => ({ categories, payees, summary, now, currency: 'USD' });
  const intentFor = (subject: string, major: number): AffordIntent => ({
    kind: 'afford',
    amount: major,
    subject,
  });

  test('Afford questions with an amount route to afford', ({ then }) => {
    then(/^"(.*)" should route to afford with amount (\d+)$/, (text: string, amount: string) => {
      const intent = detectBudgetIntent(text);
      expect(intent?.kind).toBe('afford');
      expect((intent as AffordIntent).amount).toBe(Number(amount));
    });
  });

  test("Everything else keeps today's behaviour", ({ then }) => {
    then(/^"(.*)" should not route to a budget answer$/, (text: string) => {
      expect(detectBudgetIntent(text)).toBeNull();
    });
  });

  test('A refused afford text with no amount is still refused as before', ({ then, and }) => {
    then(/^the cue check should still refuse "(.*)"$/, (text: string) => {
      expect(cueRefusal(text)).toEqual({ cue: 'can-i' });
    });
    and(/^the cue check should still log "(.*)"$/, (text: string) => {
      expect(cueRefusal(text)).toBeNull();
    });
  });

  const ask = (name: string, major: number, subject = '') => {
    amountMinor = Math.round(major * 100);
    result = affordAnswer(amountMinor, { kind: 'category', categoryId: idOf(name) }, summary);
    const p = planAfford(
      intentFor(stripAffordCue(subject || `a ${major} thing`), major),
      ctx(),
      idOf(name)
    );
    plan = p;
    reply = p.text;
  };

  test('A purchase that fits', ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when(/^I ask whether (\w+) can afford (\d+)$/, (name: string, major: string) => ask(name, Number(major), 'dinner out'));
    then(/^the verdict should be (\w+) with (-?\d+) left now and (-?\d+) after$/, (v: string, left: string, after: string) => {
      expect(result).toMatchObject({ verdict: v, leftNow: Number(left) * 100, after: Number(after) * 100 });
    });
    and(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
  });

  test('A purchase that does not fit', ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when(/^I ask whether (\w+) can afford (\d+) for "(.*)"$/, (name: string, major: string, subject: string) =>
      ask(name, Number(major), subject)
    );
    then(/^the verdict should be (\w+) with (-?\d+) left now and (-?\d+) after$/, (v: string, left: string, after: string) => {
      expect(result).toMatchObject({ verdict: v, leftNow: Number(left) * 100, after: Number(after) * 100 });
    });
    and(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
    and(/^the all-budgets line should read "(.*)"$/, (text: string) => {
      expect(overallLine(result!, 'USD')).toBe(text);
    });
  });

  test('Without a noun the reply says "this"', ({ given, when, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    when(/^I ask whether (\w+) can afford (\d+) for "(.*)"$/, (name: string, major: string, subject: string) =>
      ask(name, Number(major), subject)
    );
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
  });

  test('The all-budgets line is hidden when nothing would be left', ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when(/^I ask whether (\w+) can afford (\d+)$/, (name: string, major: string) => ask(name, Number(major), 'a thing'));
    then(/^the verdict should be (\w+) with (-?\d+) left now and (-?\d+) after$/, (v: string, left: string, after: string) => {
      expect(result).toMatchObject({ verdict: v, leftNow: Number(left) * 100, after: Number(after) * 100 });
    });
    and('there should be no all-budgets line', () => {
      expect(result!.overallLeftAfter).toBeLessThanOrEqual(0);
      expect(overallLine(result!, 'USD')).toBeNull();
    });
  });

  test('Against all budgets together', ({ given, when, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    const askAll = (major: string) => {
      const m = Number(major);
      const r = affordAnswer(m * 100, { kind: 'all' }, summary)!;
      reply = affordReply({ result: r, categoryName: null, amount: m * 100, noun: '', daysLeft: summary.daysLeft, currency: 'USD' });
    };
    when(/^I ask whether all budgets can afford (\d+)$/, askAll);
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
    when(/^I ask whether all budgets can afford (\d+)$/, askAll);
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
  });

  test('On the last day the per-day figure is dropped', ({ given, when, then }) => {
    given(/^a Dining budget of 600 with 412 spent on October 31$/, () => {
      now = local(2026, 10, 31, 10);
      rows = [budgetRow('dining', 600, '2026-01')];
      transactions = [expenseTx('dining', 412, local(2026, 10, 5))];
      compute();
    });
    when(/^I ask whether Dining can afford 60$/, () => ask('Dining', 60, 'dinner'));
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
  });

  test('The category comes from the existing deterministic inference', ({ given, and, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    and(/^a payee "(.*)" whose default category is Dining$/, (name: string) => {
      payees = [{ id: 'p-subway', name, defaultCategoryId: 'dining' }];
    });
    then(/^the category for "(.*)" should be (\w+)$/, (text: string, name: string) => {
      expect(inferAffordCategory(text, ctx())).toBe(idOf(name));
    });
    and(/^the category for "(.*)" should be (\w+)$/, (text: string, name: string) => {
      expect(inferAffordCategory(text, ctx())).toBe(idOf(name));
    });
    and(/^the category for "(.*)" should be unknown$/, (text: string) => {
      expect(inferAffordCategory(text, ctx())).toBeNull();
    });
  });

  test('An unclear category asks which budget, in attention order', ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when(/^I ask about "(.*)" for (\d+)$/, (subject: string, major: string) => {
      plan = planAfford(intentFor(subject, Number(major)), ctx());
      reply = plan.text;
    });
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
    and(/^the chips should be "(.*)" plus all budgets$/, (list: string) => {
      expect(plan!.kind).toBe('pick');
      const names = (plan as Extract<AffordPlan, { kind: 'pick' }>).options.map((o) => o.name);
      expect(names.join(', ')).toBe(list);
      expect(names).toHaveLength(6);
    });
  });

  test('No budgets at all', ({ given, when, then }) => {
    given('a ledger with no budgets on October 18', () => {
      rows = [];
      transactions = mockupFixture().transactions;
      compute();
    });
    when(/^I ask about "(.*)" for (\d+)$/, (subject: string, major: string) => {
      plan = planAfford(intentFor(subject, Number(major)), ctx());
      reply = plan.text;
    });
    then(/^the reply should read "(.*)"$/, (text: string) => expect(reply).toBe(text));
  });

  test('A second sentence never becomes the logged amount', ({ then, and }) => {
    then(/^"(.*)" should log "(.*)"$/, (text: string, logged: string) => {
      const intent = detectBudgetIntent(text) as AffordIntent;
      expect(intent.amount).toBe(300);
      expect(affordLogText(intent)).toBe(logged);
    });
    and(/^an afford of 300 for "(.*)" should log "(.*)"$/, (subject: string, logged: string) => {
      expect(affordLogText({ kind: 'afford', amount: 300, subject })).toBe(logged);
    });
  });

  test("Log it presets the budget's category unless the parse found a subcategory of it", ({ given, then, and }) => {
    let cats: Category[] = [];
    given('a Dining budget with a Takeout subcategory and a Groceries category', () => {
      cats = [
        ...categories,
        { id: 'takeout', name: 'Takeout', kind: 'expense', parentId: 'dining', icon: '🥡' },
      ];
    });
    const dining = { id: 'dining', name: 'Dining' };
    then(/^a draft in "(.*)" should keep its category for the Dining budget$/, (name: string) => {
      expect(presetCategoryName(name, dining, cats)).toBeNull();
    });
    and(/^a draft in "(.*)" should be preset to "(.*)"$/, (name: string, preset: string) => {
      expect(presetCategoryName(name, dining, cats)).toBe(preset);
    });
    and(/^a draft with no category should be preset to "(.*)"$/, (preset: string) => {
      expect(presetCategoryName(null, dining, cats)).toBe(preset);
    });
  });

  test("The past-tense guard reads only the question's own sentence", ({ then }) => {
    then(/^"(.*)" should route to afford and log "(.*)"$/, (text: string, logged: string) => {
      const intent = detectBudgetIntent(text) as AffordIntent;
      expect(intent?.kind).toBe('afford');
      expect(intent.amount).toBe(300);
      expect(affordLogText(intent)).toBe(logged);
    });
  });

  test('A stale chip pointing at a removed budget asks again instead of claiming there are none', ({
    given,
    when,
    then,
  }) => {
    given('the mockup fixture on October 18', givenMockup);
    when('the Dining budget is removed and I answer a chip for Dining', () => {
      rows = FIXTURE_BUDGETS.filter((r) => r.categoryId !== 'dining');
      compute();
      plan = planAfford(intentFor('a thing', 40), ctx(), idOf('Dining'));
    });
    then('the plan should ask which budget, offering the remaining budgets', () => {
      expect(plan!.kind).toBe('pick');
      const names = (plan as Extract<AffordPlan, { kind: 'pick' }>).options.map((o) => o.name);
      expect(names).not.toContain('Dining');
      expect(names.length).toBeGreaterThan(0);
    });
  });
});
