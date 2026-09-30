/**
 * Small, framework-free date helpers. Pure so they're unit-testable in plain
 * Node and shareable between the transaction form (date picker) and the
 * assistant feed (today's-entries filter). Display format across the app is
 * dd-MM-yyyy.
 */

/** Format epoch ms as `dd-MM-yyyy` (the app's display + transaction date format). */
export function formatDMY(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/** Midnight (local) at the start of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True when two epoch-ms timestamps fall on the same local calendar day. */
export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** "July 2026" — the month/year label for the local calendar month containing
 *  `ms`. Used by src/features/widget/summary.ts for the widget's "THIS MONTH"
 *  summary (`periodLabel`). */
export function monthLabel(ms: number): string {
  return MONTH_YEAR.format(new Date(ms));
}

// Formatters are costly to build and cheap to reuse, and these run per
// ledger row / section header — build each once (issue #27).
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const SHORT_MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** "Sep 30" — the short date used on rows, planned items and labels. */
export function shortMonthDay(ms: number): string {
  return SHORT_MONTH_DAY.format(new Date(ms));
}

/** Epoch ms at 12:00 local time of the local calendar day containing `epoch`.
 *  The timezone-stable identity for a calendar day used by the recurrence
 *  engine — noon avoids the midnight/DST off-by-one that midnight-UTC caused
 *  (assessment H3). */
export function localDayNoon(epoch: number): number {
  const d = new Date(epoch);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}

/** `noonEpoch` shifted by `days` local calendar days, re-landing on noon.
 *  Calendar-day (not fixed-ms) arithmetic — DST-immune and strictly
 *  monotonic in `days`, unlike stepping by `days * 86_400_000` ms, which can
 *  stall across a spring-forward (23h) day. `days` may be negative. */
export function addLocalDays(noonEpoch: number, days: number): number {
  const d = new Date(noonEpoch);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12, 0, 0, 0).getTime();
}
