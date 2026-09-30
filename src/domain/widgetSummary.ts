/**
 * Pure pieces of the widget-summary refresh (src/features/widget/summary.ts),
 * kept framework-free so the plain-Node BDD suite can pin them.
 *
 * The refresh used to read EVERY account and transaction through SQLCipher,
 * filter and sum them in JS, rewrite the App Group file and ask WidgetKit to
 * reload — on every single save, so a 20-row statement import did it 20
 * times (issue #27). Now it is one SQL aggregate over `widgetCountedWindow`,
 * saves are coalesced by `createDebounced`, and a summary whose
 * `widgetSummaryKey` hasn't changed is neither written nor reloaded.
 */
import { endOfPeriod, startOfPeriod } from './period';

/**
 * The occurredAt window whose non-pending rows the widget counts: from the
 * start of the current local month up to (exclusive) the start of tomorrow.
 * Equivalent to totalsForRange(month) + isCounted — isCounted drops rows
 * dated after today, and every such row is at or past tomorrow's midnight —
 * so the SQL filter `start <= occurred_at < end AND NOT pending` matches the
 * dashboard's own totals.
 */
export function widgetCountedWindow(now: number): { start: number; end: number } {
  const start = startOfPeriod(now, 'month');
  const tomorrow = endOfPeriod(startOfPeriod(now, 'day'), 'day');
  return { start, end: Math.min(tomorrow, endOfPeriod(start, 'month')) };
}

/** What the widget actually shows. `updatedAt` is left out on purpose: the
 *  widget never renders it, so a refresh that only moves the clock is not a
 *  change worth a file write and a WidgetKit reload. */
export function widgetSummaryKey(s: {
  periodLabel: string;
  incomeMinor: number;
  expenseMinor: number;
  currency: string;
}): string {
  return `${s.periodLabel}|${s.incomeMinor}|${s.expenseMinor}|${s.currency}`;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Trailing-edge debounce. `schedule()` (re)starts the wait; `flush()` cancels
 * any pending wait and runs now; `cancel()` just drops the pending wait —
 * for a caller about to do the work itself (the app going to the background,
 * where JS timers stop).
 */
export function createDebounced(
  fn: () => void,
  waitMs: number,
  timers: Timers
): { schedule(): void; flush(): void; cancel(): void } {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  return {
    schedule() {
      cancel();
      handle = timers.setTimeout(() => {
        handle = null;
        fn();
      }, waitMs);
    },
    flush() {
      cancel();
      fn();
    },
    cancel,
  };
}
