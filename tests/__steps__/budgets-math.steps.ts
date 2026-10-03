import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, RecurringSeries, Transaction } from '../../src/domain/types';
import {
  BudgetSummary,
  CategoryBudget,
  computeBudgets,
  dashboardRows,
} from '../../src/domain/budgets';
import {
  categoryDetailLine,
  formatBudgetMoney,
  legendText,
  leftOrOver,
  moreLine,
  paceLine,
} from '../../src/domain/budgetCopy';
import { formatBudgetWhole } from '../../src/domain/budgetCopy';
import {
  FIXTURE_BUDGETS,
  FIXTURE_CATEGORIES,
  NOW,
  budgetRow,
  cat,
  expenseTx,
  local,
  mockupFixture,
  monthlySeries,
  postedFrom,
} from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-math.feature'));

const MONTHS: Record<string, number> = { October: 10, September: 9, November: 11 };
const dayOf = (label: string): number => {
  const [name, day] = label.split(' ');
  return local(2026, MONTHS[name!]!, Number(day), 10);
};

defineFeature(feature, (test) => {
  let now = NOW;
  let categories: Category[] = [];
  let transactions: Transaction[] = [];
  let series: RecurringSeries[] = [];
  let summary: BudgetSummary;
  let singtel: RecurringSeries | null;

  beforeEach(() => {
    now = NOW;
    categories = [...FIXTURE_CATEGORIES, cat('salary', 'Salary', '💰')];
    categories[categories.length - 1] = { ...categories[categories.length - 1]!, kind: 'income' };
    transactions = [];
    series = [];
    singtel = null;
  });

  const byName = (name: string): CategoryBudget => {
    const id = FIXTURE_CATEGORIES.find((c) => c.name === name)!.id;
    const v = summary.categories.find((x) => x.categoryId === id);
    if (!v) throw new Error(`${name} is not budgeted`);
    return v;
  };
  const names = (views: CategoryBudget[]) =>
    views.map((v) => FIXTURE_CATEGORIES.find((c) => c.id === v.categoryId)!.name);
  const compute = (month: string, rows = FIXTURE_BUDGETS) => {
    summary = computeBudgets({ transactions, series, categories, rows, now, month });
  };

  const givenMockup = () => {
    const f = mockupFixture();
    transactions = f.transactions;
    series = f.series;
  };

  test("The mockup's October fixture reproduces every figure", ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when('I compute the October budgets', () => compute('2026-10'));
    then(/^(\d+) should be left of (\d+) budgeted$/, (left: string, budget: string) => {
      expect(summary.left).toBe(Number(left) * 100);
      expect(summary.budget).toBe(Number(budget) * 100);
    });
    and(/^spent should be (\d+) and scheduled (\d+)$/, (spent: string, scheduled: string) => {
      expect(summary.spent).toBe(Number(spent) * 100);
      expect(summary.scheduled).toBe(Number(scheduled) * 100);
    });
    and(/^the overall chip should read "(.*)"$/, (chip: string) => {
      expect(summary.chip).toBe(chip);
      expect(summary.chipState).toBe('warn');
    });
    and(/^per day should be (\d+) with (\d+) days left$/, (perDay: string, days: string) => {
      expect(summary.perDay).toBe(Number(perDay) * 100);
      expect(summary.daysLeft).toBe(Number(days));
    });
    and(/^Today's tick should sit at ([\d.]+) percent$/, (pct: string) => {
      expect(Math.round(summary.tick! * 1000) / 10).toBe(Number(pct));
    });
    and(/^Entertainment should be over by (\d+)$/, (over: string) => {
      const v = byName('Entertainment');
      expect(v.state).toBe('over');
      expect(-v.left).toBe(Number(over) * 100);
    });
    and(/^Dining should be warn$/, () => expect(byName('Dining').state).toBe('warn'));
    and('these should be ok:', (rows: Array<Record<string, string>>) => {
      for (const row of rows) {
        const name = Object.values(row)[0]!;
        expect({ name, state: byName(name).state }).toEqual({ name, state: 'ok' });
      }
    });
    and(/^the dashboard's worst 3 should be "(.*)"$/, (list: string) => {
      expect(names(dashboardRows(summary).rows).join(', ')).toBe(list);
    });
    and(/^the dashboard footer should read "(.*)"$/, (text: string) => {
      const d = dashboardRows(summary);
      expect(moreLine(d.moreCount, d.moreAllOk)).toBe(text);
    });
    and(/^the Budget screen order should be "(.*)"$/, (list: string) => {
      expect(names(summary.categories).join(', ')).toBe(list);
    });
    and(/^Not budgeted should be "(.*)"$/, (list: string) => {
      const actual = summary.notBudgeted.map(
        (n) => `${FIXTURE_CATEGORIES.find((c) => c.id === n.categoryId)!.name} ${n.amount / 100}`
      );
      expect(actual.join(', ')).toBe(list);
    });
    and(
      /^Bills should have (\d+) paid, (\d+) scheduled and fixed (\d+)$/,
      (paid: string, scheduled: string, fixed: string) => {
        const v = byName('Bills');
        expect(v.spent).toBe(Number(paid) * 100);
        expect(v.scheduled).toBe(Number(scheduled) * 100);
        expect(v.fixed).toBe(Number(fixed) * 100);
      }
    );
  });

  test('The mockup copy is produced by the templates', ({ given, when, then, and }) => {
    given('the mockup fixture on October 18', givenMockup);
    when('I compute the October budgets', () => compute('2026-10'));
    then(/^the headline copy should be "(.*)"$/, (text: string) => {
      expect(`${formatBudgetMoney(summary.left)} left of ${formatBudgetMoney(summary.budget)}`).toBe(text);
    });
    and(/^the legend should read "(.*)" and "(.*)"$/, (spent: string, scheduled: string) => {
      const l = legendText(summary.spent, summary.scheduled, 'USD');
      expect(l.spent).toBe(spent);
      expect(l.scheduled).toBe(scheduled);
    });
    and(/^the pace line should read "(.*)"$/, (text: string) => {
      expect(paceLine(summary, 'USD')).toBe(text);
    });
    and(/^Entertainment's row should read "(.*)"$/, (text: string) => {
      expect(leftOrOver(byName('Entertainment').left, 'USD')).toBe(text);
    });
    and(/^Dining's row should read "(.*)"$/, (text: string) => {
      expect(leftOrOver(byName('Dining').left, 'USD')).toBe(text);
    });
    and(/^Bills' detail line should read "(.*)"$/, (text: string) => {
      expect(categoryDetailLine(byName('Bills'), 'USD')).toBe(text);
    });
  });

  // ── dedupe ────────────────────────────────────────────────────────────────
  const givenSingtel = () => {
    singtel = monthlySeries('s-singtel', 'bills', 50, local(2026, 9, 22), { postedCount: 1 });
    series = [singtel];
  };
  const givenToday = (label: string) => {
    now = dayOf(label);
  };
  const computeBills = () => compute('2026-10', [budgetRow('bills', 350, '2026-01')]);
  const computeCategoryBudget = (name: string, major: string) =>
    compute('2026-10', [
      budgetRow(FIXTURE_CATEGORIES.find((c) => c.name === name)!.id, Number(major), '2026-01'),
    ]);
  const thenShows = (spent: string, scheduled: string) => {
    expect(summary.categories).toHaveLength(1);
    expect(summary.categories[0]!.spent).toBe(Number(spent) * 100);
    expect(summary.categories[0]!.scheduled).toBe(Number(scheduled) * 100);
  };

  test('A recurring occurrence already posted today is counted once, as spent', ({ given, and, when, then }) => {
    given(/^a monthly Bills series of 50 due on the 22nd$/, givenSingtel);
    and(/^today is (.*)$/, givenToday);
    and('the October 22 occurrence has already been posted', () => {
      transactions.push(postedFrom(singtel!, local(2026, 10, 22)));
    });
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test('The same occurrence not yet posted counts as scheduled', ({ given, and, when, then }) => {
    given(/^a monthly Bills series of 50 due on the 22nd$/, givenSingtel);
    and(/^today is (.*)$/, givenToday);
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test('A skipped date is not counted at all', ({ given, and, when, then }) => {
    given(/^a monthly Bills series of 50 due on the 22nd$/, givenSingtel);
    and(/^today is (.*)$/, givenToday);
    and('the October 22 occurrence is skipped', () => {
      series = [{ ...singtel!, skippedDates: [local(2026, 10, 22)] }];
    });
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test('A paused series is not counted', ({ given, and, when, then }) => {
    given(/^a monthly Bills series of 50 due on the 22nd$/, givenSingtel);
    and(/^today is (.*)$/, givenToday);
    and('the series is paused', () => {
      series = [{ ...singtel!, paused: true }];
    });
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test('A pending expense is scheduled until it is un-pended', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a pending Bills expense of (\d+) dated (.*)$/, (major: string, date: string) => {
      transactions.push(expenseTx('bills', Number(major), dayOf(date), { pending: true }));
    });
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  // ── what counts ───────────────────────────────────────────────────────────
  const dining = (major: string, date: string, extra: Partial<Transaction> = {}) =>
    transactions.push(expenseTx('dining', Number(major), dayOf(date), extra));
  const computeDining = () => computeCategoryBudget('Dining', '500');

  test('Transfers and income never count', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of (\d+) on (.*)$/, dining);
    and(/^a transfer of (\d+) filed under Dining on (.*)$/, (major: string, date: string) => {
      dining(major, date, { type: 'transfer', transferAccountId: 'acc-2' });
    });
    and(/^an income of (\d+) filed under Salary on (.*)$/, (major: string, date: string) => {
      transactions.push(expenseTx('salary', Number(major), dayOf(date), { type: 'income' }));
    });
    when(/^I compute the Dining budget of 500 for October$/, computeDining);
    then(/^Dining should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test("A refund reduces the category's spend", ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of (\d+) on (.*)$/, dining);
    and(/^a Dining refund of (\d+) on (.*)$/, (major: string, date: string) => {
      dining(major, date, { type: 'income' });
    });
    when(/^I compute the Dining budget of 500 for October$/, computeDining);
    then(/^Dining should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test('A child category rolls up into its parent', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of (\d+) on (.*)$/, dining);
    and(
      /^a Takeout expense of (\d+) on (.*), where Takeout is a child of Dining$/,
      (major: string, date: string) => {
        categories.push(cat('takeout', 'Takeout', '🥡', 'dining'));
        transactions.push(expenseTx('takeout', Number(major), dayOf(date)));
      }
    );
    when(/^I compute the Dining budget of 500 for October$/, computeDining);
    then(/^Dining should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  test("An archived account's expense counts", ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(
      /^a Dining expense of (\d+) on (.*) on an archived account$/,
      (major: string, date: string) => dining(major, date, { accountId: 'archived-acc' })
    );
    when(/^I compute the Dining budget of 500 for October$/, computeDining);
    then(/^Dining should show (\d+) spent and (\d+) scheduled$/, thenShows);
  });

  // ── pace ──────────────────────────────────────────────────────────────────
  test('A bill paid on the 1st does not push the category to warn', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(
      /^a Bills expense of (\d+) posted from a recurring series on (.*)$/,
      (major: string, date: string) => {
        const s = monthlySeries('s-rent', 'bills', Number(major), local(2026, 9, 1));
        series = [s];
        transactions.push(postedFrom(s, dayOf(date)));
      }
    );
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then('Bills should be ok', () => {
      expect(summary.categories[0]!.state).toBe('ok');
    });
  });

  const computeTotal = () => compute('2026-10', [budgetRow('dining', 3000, '2026-01')]);

  test('Days left and per-day follow the calendar', ({ given, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    when(/^I compute a 3000 total budget with nothing spent$/, computeTotal);
    then(/^days left should be (\d+) and per-day should be (.*)$/, (days: string, perDay: string) => {
      expect(summary.daysLeft).toBe(Number(days));
      expect(summary.perDay === null ? 'none' : formatBudgetWhole(summary.perDay, 'USD')).toBe(perDay);
    });
  });

  test('Last day shows no per-day figure, and an empty budget hides it', ({ given, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    when(/^I compute a 3000 total budget with nothing spent$/, computeTotal);
    then(/^the pace line should read "(.*)"$/, (text: string) => {
      expect(paceLine(summary, 'USD')).toBe(text);
      expect(summary.perDay).toBeNull();
    });
  });

  test('A past month shows no tick, chip or per-day figure', ({ given, when, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    when('I compute the September budgets', () => compute('2026-09'));
    then('there should be no tick, chip, days left or per-day figure', () => {
      expect(summary.tick).toBeNull();
      expect(summary.chip).toBeNull();
      expect(summary.daysLeft).toBeNull();
      expect(summary.perDay).toBeNull();
      expect(summary.categories.every((v) => v.tick === null)).toBe(true);
    });
  });

  test('A future month has nothing spent', ({ given, when, then }) => {
    given('the mockup fixture on October 18', givenMockup);
    when('I compute the November budgets', () => compute('2026-11'));
    then('spent should be 0 and the recurring Bills should be scheduled', () => {
      expect(summary.spent).toBe(0);
      // Mobile plan 42 + SP Group 130 + Singtel 50 recur in November; AIA (a
      // one-off dated in October) does not.
      expect(byName('Bills').scheduled).toBe(22200);
      expect(summary.tick).toBeNull();
    });
  });

  // ── edges ─────────────────────────────────────────────────────────────────
  const computeDiningFor = (major: string, monthName: string) => {
    const month = `2026-${String(MONTHS[monthName]).padStart(2, '0')}`;
    compute(month, [budgetRow('dining', Number(major), '2026-01')]);
  };

  test('A budget made entirely of bills has nothing left and is not NaN', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(
      /^a Bills expense of (\d+) posted from a recurring series on (.*)$/,
      (major: string, date: string) => {
        const s = monthlySeries('s-rent', 'bills', Number(major), local(2026, 9, 1));
        series = [s];
        transactions.push(postedFrom(s, dayOf(date)));
      }
    );
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then('Bills should be ok with 0 left and finite figures', () => {
      const v = summary.categories[0]!;
      expect(v.state).toBe('ok');
      expect(v.left).toBe(0);
      for (const n of [v.ratio, v.target!, v.tick!, v.left, v.fixed]) expect(Number.isFinite(n)).toBe(true);
    });
  });

  test('Bills beyond the budget are over and the flexible test is skipped', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(
      /^a Bills expense of (\d+) posted from a recurring series on (.*)$/,
      (major: string, date: string) => {
        const s = monthlySeries('s-rent', 'bills', Number(major), local(2026, 9, 1));
        series = [s];
        transactions.push(postedFrom(s, dayOf(date)));
      }
    );
    when(/^I compute the Bills budget of 350 for October$/, computeBills);
    then(/^Bills should be over by (\d+)$/, (over: string) => {
      const v = summary.categories[0]!;
      expect(v.state).toBe('over');
      expect(-v.left).toBe(Number(over) * 100);
      expect(Number.isFinite(v.ratio)).toBe(true);
    });
  });

  test('The overall chip at the edge of the ten percent band', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of ([\d.]+) on (.*)$/, (major: string, date: string) => {
      transactions.push(expenseTx('dining', Number(major), dayOf(date)));
    });
    when(/^I compute the Dining budget of 1000 for (\w+)$/, (month: string) => computeDiningFor('1000', month));
    then(/^the overall chip should read "(.*)"$/, (chip: string) => {
      expect(summary.chip).toBe(chip);
    });
  });

  test('An over-budget month mid-way shows no per-day figure', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of (\d+) on (.*)$/, dining);
    when(/^I compute the Dining budget of 1000 for (\w+)$/, (month: string) => computeDiningFor('1000', month));
    then(
      /^per-day should be hidden with (\d+) days left and the pace line "(.*)"$/,
      (days: string, line: string) => {
        expect(summary.left).toBeLessThan(0);
        expect(summary.daysLeft).toBe(Number(days));
        expect(summary.perDay).toBeNull();
        expect(paceLine(summary, 'USD')).toBe(line);
      }
    );
  });

  test('Spent never goes below zero', ({ given, and, when, then }) => {
    given(/^today is (.*)$/, givenToday);
    and(/^a Dining expense of (\d+) on (.*)$/, dining);
    and(/^a Dining refund of (\d+) on (.*)$/, (major: string, date: string) => {
      dining(major, date, { type: 'income' });
    });
    when(/^I compute the Dining budget of 500 for October$/, computeDining);
    then(/^Dining should show (\d+) spent and (\d+) scheduled$/, thenShows);
    and('Dining should have the whole 500 left', () => {
      expect(summary.categories[0]!.left).toBe(50000);
    });
  });
});
