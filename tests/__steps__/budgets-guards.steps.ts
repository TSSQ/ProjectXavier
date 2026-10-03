import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category } from '../../src/domain/types';
import { computeBudgets, monthLabel } from '../../src/domain/budgets';
import {
  SetBudgetCheck,
  checkSetBudgetConfirm,
  isStaleBudgetReply,
} from '../../src/domain/budgetReplyGuard';
import { barGeometry } from '../../src/domain/barGeometry';
import { darkColors, lightColors } from '../../src/theme/tokens';
import { NOW, budgetRow, cat, expenseTx, local } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-guards.feature'));

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  const givenCategories = () => {
    categories = [cat('groceries', 'Groceries', '🛒'), cat('dining', 'Dining', '🍔')];
  };
  let check: SetBudgetCheck;
  const confirm = (built: string, category: string, now: string) => {
    check = checkSetBudgetConfirm({ categoryId: category, currency: built, currentCurrency: now, categories });
  };
  const thenCheck = (result: string) => expect(check).toBe(result);

  test('A card is stale once the data revision moves on', ({ then }) => {
    then('a card built at revision 7 should be fresh at 7 and stale at 8', () => {
      expect(isStaleBudgetReply(7, 7)).toBe(false);
      expect(isStaleBudgetReply(7, 8)).toBe(true);
    });
  });

  test('A set-budget confirm re-checks the category and the currency', ({ given, when, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    when(/^I confirm a "(.*)" budget for "(.*)" while the currency is "(.*)"$/, confirm);
    then(/^the check should be "(.*)"$/, thenCheck);
  });

  test('A category that became a child no longer takes a budget', ({ given, and, when, then }) => {
    given('the categories Groceries and Dining', givenCategories);
    and('Groceries is now a child of Dining', () => {
      categories = categories.map((c) => (c.id === 'groceries' ? { ...c, parentId: 'dining' } : c));
    });
    when(/^I confirm a "(.*)" budget for "(.*)" while the currency is "(.*)"$/, confirm);
    then(/^the check should be "(.*)"$/, thenCheck);
  });

  test('A child whose parent was deleted counts as top-level', ({ given, when, then }) => {
    let summary: ReturnType<typeof computeBudgets>;
    const orphan = cat('orphan', 'Orphan', '👻', 'deleted-parent');
    let txs = [] as ReturnType<typeof expenseTx>[];
    given(/^an orphaned expense category with (\d+) spent in October$/, (major: string) => {
      txs = [expenseTx('orphan', Number(major), local(2026, 10, 5))];
    });
    const compute = (rows: ReturnType<typeof budgetRow>[]) => {
      summary = computeBudgets({ transactions: txs, series: [], categories: [orphan], rows, now: NOW, month: '2026-10' });
    };
    when(/^I compute October with no budget for it$/, () => compute([]));
    then(/^the orphan should appear under Not budgeted at (\d+)$/, (major: string) => {
      expect(summary.notBudgeted).toEqual([{ categoryId: 'orphan', amount: Number(major) * 100 }]);
    });
    when(/^I compute October with a budget of (\d+) for it$/, (major: string) =>
      compute([budgetRow('orphan', Number(major), '2026-01')])
    );
    then(/^the orphan should have (\d+) left$/, (major: string) => {
      expect(summary.categories[0]!.left).toBe(Number(major) * 100);
    });
  });

  test('Month labels carry the year only when it is not the current one', ({ then, and }) => {
    const now = local(2026, 10, 18);
    then(/^the label for "(.*)" in 2026 should be "(.*)" and short "(.*)"$/, (m: string, long: string, short: string) => {
      expect(monthLabel(m, now)).toBe(long);
      expect(monthLabel(m, now, true)).toBe(short);
    });
    and(/^the label for "(.*)" in 2026 should be "(.*)" and short "(.*)"$/, (m: string, long: string, short: string) => {
      expect(monthLabel(m, now)).toBe(long);
      expect(monthLabel(m, now, true)).toBe(short);
    });
  });

  test("The warn colour is a named token with the mockup's hexes", ({ then, and }) => {
    then(/^the dark warn token should be "(.*)" and the light one "(.*)"$/, (dark: string, light: string) => {
      expect(darkColors.warn).toBe(dark);
      expect(lightColors.warn).toBe(light);
      expect(darkColors.chartPalette[6]).toBe(dark);
      expect(lightColors.chartPalette[6]).toBe(light);
    });
    and("the warn chip background and the ok and over backgrounds match the mockup's", () => {
      expect([darkColors.warnBg, lightColors.warnBg]).toEqual(['#3A321C', '#F6EDD3']);
      expect([darkColors.amountPosBg, lightColors.amountPosBg]).toEqual(['#10301F', '#DCF1E6']);
      expect([darkColors.amountNegBg, lightColors.amountNegBg]).toEqual(['#3A1F27', '#FBE1E8']);
    });
  });

  test('A purchase that exactly fills what is left is not capped', ({ then, and }) => {
    then('a ghost of 40 against 100 with 60 spent should not be capped', () => {
      const g = barGeometry({ budget: 100, spent: 60, ghostAmount: 40 });
      expect(g.capped).toBe(false);
      expect(g.ghost).toBeCloseTo(0.4);
    });
    and('a ghost of 41 against 100 with 60 spent should be capped and clamped', () => {
      const g = barGeometry({ budget: 100, spent: 60, ghostAmount: 41 });
      expect(g.capped).toBe(true);
      expect(g.ghost).toBeCloseTo(0.4);
    });
  });
});
