import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { BudgetRow, BudgetScope, budgetFor, planBudgetWrite } from '../../src/domain/budgets';
import { budgetRow } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-resolution.feature'));

/** Applies a write plan to an in-memory row set the way the SQL does. */
function applyWrite(rows: BudgetRow[], plan: ReturnType<typeof planBudgetWrite>): BudgetRow[] {
  const kept =
    plan.deleteFromMonth === null
      ? rows
      : rows.filter(
          (r) => !(r.categoryId === plan.insert.categoryId && r.startMonth >= plan.deleteFromMonth!)
        );
  return [...kept, plan.insert];
}

defineFeature(feature, (test) => {
  let rows: BudgetRow[] = [];
  let clock = 10;
  beforeEach(() => {
    rows = [];
    clock = 10;
  });

  const onward = (major: string, from: string) => {
    rows.push(budgetRow('dining', Number(major), from, null, ++clock));
  };
  const oneOff = (major: string, month: string) => {
    rows.push(budgetRow('dining', Number(major), month, month, ++clock));
  };
  const thenBudget = (month: string, expected: string) => {
    const actual = budgetFor(rows, 'dining', month);
    expect(actual).toBe(expected === 'none' ? null : Number(expected) * 100);
  };
  const write = (major: number, month: string, scope: BudgetScope) => {
    rows = applyWrite(
      rows,
      planBudgetWrite({
        id: `w-${++clock}`,
        categoryId: 'dining',
        amount: major * 100,
        month,
        scope,
        now: ++clock,
      })
    );
  };


  test('A one-off October row overrides an onward September row for October only', ({ given, and, then }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    and(/^a one-off Dining budget of (\d+) for "(.*)"$/, oneOff);
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
  });

  test('A NULL amount means no budget from that month on', ({ given, and, then }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    and(/^Dining has no budget from "(.*)"$/, (from: string) => {
      rows.push(budgetRow('dining', null, from, null, ++clock));
    });
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
  });

  test('Ties on the start month go to the latest written row', ({ given, and, then }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    and(/^a later onward Dining budget of (\d+) from "(.*)"$/, onward);
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
  });

  test('An onward write from November deletes a December one-off', ({ given, and, when, then }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    and(/^a one-off Dining budget of (\d+) for "(.*)"$/, oneOff);
    when(/^I set Dining to (\d+) onward from "(.*)"$/, (major: string, month: string) =>
      write(Number(major), month, 'onward')
    );
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
  });

  test('A one-off write leaves later months alone', ({ given, when, then, and }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    when(/^I set Dining to (\d+) for "(.*)" only$/, (major: string, month: string) =>
      write(Number(major), month, 'month')
    );
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
  });

  test('Zero is Remove and is never stored as a budget', ({ given, when, then, and }) => {
    given(/^an onward Dining budget of (\d+) from "(.*)"$/, onward);
    when(/^I set Dining to 0 onward from "(.*)"$/, (month: string) => write(0, month, 'onward'));
    then(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^the Dining budget for "(.*)" should be (\w+)$/, thenBudget);
    and(/^no stored row should hold an amount of 0$/, () => {
      expect(rows.some((r) => r.amount === 0)).toBe(false);
    });
  });
});
