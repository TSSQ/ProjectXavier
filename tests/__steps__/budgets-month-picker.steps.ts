import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { BudgetRow, budgetExtraMonthStarts, monthKeyOf, monthStart } from '../../src/domain/budgets';
import { PeriodSummary, withExtraPeriods } from '../../src/domain/period';
import { budgetRow, local } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-month-picker.feature'));

const monthKeys = (list: string) => (list ? list.split(',') : []);
const starts = (list: string) => monthKeys(list).map(monthStart);
const keys = (epochs: number[]) => epochs.map(monthKeyOf).join(',');
const nowOf = (year: number, month: number) => local(year, month, 18, 10);
const MONTHS: Record<string, number> = { October: 10, December: 12 };
const periodsOf = (list: string): PeriodSummary[] =>
  starts(list).map((start) => ({
    start,
    end: start,
    totals: { income: 100, expense: 50, net: 50 },
  }));
const rowsOf = (list: string): BudgetRow[] =>
  monthKeys(list).map((spec) => {
    const [start, end] = spec.split(':');
    return budgetRow('dining', 100, start!, end ?? null);
  });

defineFeature(feature, (test) => {
  test('A month key converts to its local start and back', ({ then }) => {
    then(/^month "(.*)" should start at the local midnight of its first day and map back$/, (key: string) => {
      const [y, m] = key.split('-').map(Number);
      expect(monthStart(key)).toBe(local(y!, m!, 1, 0));
      expect(monthKeyOf(monthStart(key))).toBe(key);
    });
  });

  const extrasStep = (then: (re: RegExp, fn: (...a: string[]) => void) => void) =>
    then(
      /^the extra months at (\w+) 2026 with "(.*)" selected(?: and budgets "(.*)")? should be "(.*)"$/,
      (monthName: string, sel: string, budgets: string | undefined, want: string) => {
        const got = budgetExtraMonthStarts(nowOf(2026, MONTHS[monthName]!), sel, rowsOf(budgets ?? ''));
        expect(keys(got)).toBe(want);
      }
    );

  test('The extra months are current, next and selected', ({ then }) => extrasStep(then));
  test('Months across a year boundary', ({ then }) => extrasStep(then));
  test('A selected month equal to the current or next month is deduped', ({ then, and }) => {
    extrasStep(then);
    extrasStep(and);
  });
  test('Stored budget months are included, including ones set far ahead', ({ then }) => extrasStep(then));
  test('A malformed month key is rejected', ({ then }) => extrasStep(then));

  test('Activity and extra periods merge deduped and newest first', ({ then }) => {
    then(/^merging activity "(.*)" with extras "(.*)" should give "(.*)"$/, (a: string, e: string, want: string) => {
      const merged = withExtraPeriods(periodsOf(a), starts(e), 'month');
      expect(keys(merged.map((p) => p.start))).toBe(want);
    });
  });

  test('An injected current month has zero totals', ({ then }) => {
    then(
      /^merging activity "(.*)" with extras "(.*)" should give "(.*)" with "(.*)" empty$/,
      (a: string, e: string, want: string, empty: string) => {
        const merged = withExtraPeriods(periodsOf(a), starts(e), 'month');
        expect(keys(merged.map((p) => p.start))).toBe(want);
        expect(merged.find((p) => p.start === monthStart(empty))!.totals).toEqual({
          income: 0,
          expense: 0,
          net: 0,
        });
      }
    );
  });

  test('The category push carries the month', ({ then }) => {
    then(/^app\/budget\.tsx should pass month in the category detail push$/, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../app/budget.tsx'), 'utf8');
      const push = /pathname: '\/budget\/\[categoryId\]',\s*params: \{[^}]*\bmonth\b[^}]*\}/;
      expect(src).toMatch(push);
    });
  });
});
