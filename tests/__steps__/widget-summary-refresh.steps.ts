import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { createDebounced, widgetCountedWindow, widgetSummaryKey } from '../../src/domain/widgetSummary';
import { periodRange, totalsForRange } from '../../src/domain/period';
import { Transaction } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/widget-summary-refresh.feature'));

const local = (iso: string) => new Date(iso).getTime(); // no Z → local time

let seq = 0;
const tx = (occurredAt: number, type: Transaction['type'], amount: number, pending = false): Transaction =>
  ({
    id: `t${++seq}`,
    accountId: 'a1',
    type,
    amount,
    currency: 'SGD',
    occurredAt,
    createdAt: occurredAt,
    source: 'manual',
    pending,
  }) as Transaction;

/** Rows just either side of every boundary the window has to get right. */
function boundaryLedger(now: number): Transaction[] {
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const rows: Transaction[] = [];
  let amt = 1;
  for (const t of [monthStart - 1, monthStart, todayStart, now, tomorrow - 1, tomorrow, nextMonth - 1, nextMonth]) {
    rows.push(tx(t, 'expense', (amt *= 2)), tx(t, 'income', amt * 3), tx(t, 'transfer', 7));
    rows.push(tx(t, 'expense', 1000, true), tx(t, 'income', 1000, true)); // pending: never counted
  }
  return rows;
}

defineFeature(feature, (test) => {
  let now: number;

  test('The SQL window counts exactly what the dashboard counts', ({ given, and, when, then }) => {
    let ledger: Transaction[];
    let sqlTotals: { income: number; expense: number };
    given(/^today is "(.*)"$/, (iso: string) => { now = local(iso); });
    and('a ledger with rows around the month and day boundaries', () => { ledger = boundaryLedger(now); });
    when("the rows are filtered by the widget's counted window", () => {
      // The WHERE clause of summary.ts's monthTotals, row by row.
      const { start, end } = widgetCountedWindow(now);
      const hit = ledger.filter((t) => !t.pending && t.occurredAt >= start && t.occurredAt < end);
      const sum = (type: string) => hit.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
      sqlTotals = { income: sum('income'), expense: sum('expense') };
    });
    then("the income and expense match the dashboard's month totals", () => {
      const dash = totalsForRange(ledger, periodRange(now, 'month'), now);
      expect(sqlTotals).toEqual({ income: dash.income, expense: dash.expense });
      expect(dash.expense).toBeGreaterThan(0);
    });
  });

  test('On the last day of a month the window ends at the next month', ({ given, then }) => {
    given(/^today is "(.*)"$/, (iso: string) => { now = local(iso); });
    then('the window should run from 1 September to 1 October', () => {
      expect(widgetCountedWindow(now)).toEqual({ start: local('2026-09-01T00:00:00'), end: local('2026-10-01T00:00:00') });
    });
  });

  test('Only what the widget draws counts as a change', ({ given, then, and }) => {
    const base = { periodLabel: 'September 2026', incomeMinor: 500, expenseMinor: 300, currency: 'SGD', updatedAt: 1 };
    given('a widget summary', () => undefined);
    then('changing only updatedAt should keep the same key', () => {
      const later = { ...base, updatedAt: 2 };
      expect(widgetSummaryKey(later)).toBe(widgetSummaryKey(base));
    });
    and('changing the income, expense, currency or month label should each change the key', () => {
      for (const change of [{ incomeMinor: 501 }, { expenseMinor: 301 }, { currency: 'USD' }, { periodLabel: 'October 2026' }]) {
        const changed = { ...base, ...change };
        expect(widgetSummaryKey(changed)).not.toBe(widgetSummaryKey(base));
      }
    });
  });

  // A fake clock: timers fire only when the scenario advances time.
  let clock: number;
  let pending: Map<number, { at: number; fn: () => void }>;
  let runs: number;
  let d: ReturnType<typeof createDebounced>;
  const advance = (ms: number) => {
    clock += ms;
    for (const [h, t] of [...pending]) if (t.at <= clock) { pending.delete(h); t.fn(); }
  };
  const givenDebounced = (given: any) =>
    given(/^a debounced refresh with a (\d+) ms wait$/, (wait: string) => {
      clock = 0; pending = new Map(); runs = 0;
      let next = 0;
      d = createDebounced(() => { runs++; }, Number(wait), {
        setTimeout: (fn, ms) => { pending.set(++next, { at: clock + ms, fn }); return next; },
        clearTimeout: (h) => { pending.delete(h as number); },
      });
    });
  const whenScheduled = (when: any) =>
    when(/^it is scheduled (\d+) times (\d+) ms apart$/, (n: string, gap: string) => {
      for (let i = 0; i < Number(n); i++) { d.schedule(); if (i < Number(n) - 1) advance(Number(gap)); }
    });
  const passes = (step: any) => step(/^(\d+) ms pass$/, (ms: string) => advance(Number(ms)));
  const ran = (step: any) => step(/^it should have run (\d+) times?$/, (n: string) => expect(runs).toBe(Number(n)));

  test('A burst of saves refreshes once', ({ given, when, then }) => {
    givenDebounced(given);
    whenScheduled(when);
    then('it should not have run yet', () => expect(runs).toBe(0));
    passes(when);
    ran(then);
  });

  test('Flushing runs now and drops the scheduled run', ({ given, when, and, then }) => {
    givenDebounced(given);
    whenScheduled(when);
    and('it is flushed', () => d.flush());
    ran(then);
    passes(when);
    ran(then);
  });

  test('Cancelling drops the scheduled run', ({ given, when, and, then }) => {
    givenDebounced(given);
    whenScheduled(when);
    and('it is cancelled', () => d.cancel());
    passes(and);
    ran(then);
  });
});
