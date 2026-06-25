/**
 * Pure recurrence logic — no framework imports, fully unit-testable in Node.
 *
 * Design decisions baked in:
 *  - All dates are UTC start-of-day epoch ms (midnight UTC). Times within a day
 *    are discarded; only the calendar date matters for scheduling.
 *  - "Monthly on the 31st" is clamped to the last day of shorter months.
 *  - byDay for monthly/yearly is the target day-of-month (1-31).
 *  - byDay for weekly is the day-of-week (0 = Sun … 6 = Sat), unused — weekly
 *    recurrence just steps by interval × 7 days from the anchor.
 */
import { RecurrenceRule, RecurringSeries, RecurrenceTemplate } from './types';

export const MS_PER_DAY = 86_400_000;

export function startOfUTCDay(epoch: number): number {
  return Math.floor(epoch / MS_PER_DAY) * MS_PER_DAY;
}

/** Epoch ms for the given UTC calendar date, clamping day to the last day of the month. */
function utcDateMs(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(day, lastDay));
}

/**
 * Returns the next occurrence date (start-of-UTC-day, epoch ms) strictly after
 * `after`, respecting the recurrence rule. Returns null if the sequence is
 * logically exhausted (only possible for non-infinite rules; callers should
 * also check the `end` condition for count/until limits).
 */
export function nextOccurrenceAfter(rule: RecurrenceRule, after: number): number | null {
  const anchorDay = startOfUTCDay(rule.anchor);
  const afterDay = startOfUTCDay(after);

  switch (rule.freq) {
    case 'daily': {
      const step = rule.interval * MS_PER_DAY;
      if (afterDay < anchorDay) return anchorDay;
      const n = Math.floor((afterDay - anchorDay) / step) + 1;
      return anchorDay + n * step;
    }

    case 'weekly': {
      const step = rule.interval * 7 * MS_PER_DAY;
      if (afterDay < anchorDay) return anchorDay;
      const n = Math.floor((afterDay - anchorDay) / step) + 1;
      return anchorDay + n * step;
    }

    case 'monthly': {
      const ad = new Date(anchorDay);
      const targetDay = rule.byDay ?? ad.getUTCDate();
      let year = ad.getUTCFullYear();
      let month = ad.getUTCMonth();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = utcDateMs(year, month, targetDay);
        if (candidate > afterDay) return candidate;
        month += rule.interval;
        year += Math.floor(month / 12);
        month = ((month % 12) + 12) % 12;
      }
    }

    case 'yearly': {
      const ad = new Date(anchorDay);
      const targetMonth = ad.getUTCMonth();
      const targetDay = rule.byDay ?? ad.getUTCDate();
      let year = ad.getUTCFullYear();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = utcDateMs(year, targetMonth, targetDay);
        if (candidate > afterDay) return candidate;
        year += rule.interval;
      }
    }
  }
}

/**
 * Returns all occurrence dates that are due between (lastPostedAt, now] and
 * satisfy the rule's end condition. Skipped dates are omitted. Each element is
 * a start-of-UTC-day epoch ms.
 *
 * Safe to call repeatedly — already-posted dates are excluded because the
 * cursor starts at lastPostedAt.
 */
export function dueOccurrences(series: RecurringSeries, now: number): number[] {
  if (series.paused || series.archived) return [];

  const { rule, lastPostedAt, postedCount, skippedDates } = series;
  const skipped = new Set(skippedDates);
  const nowDay = startOfUTCDay(now);
  const anchorDay = startOfUTCDay(rule.anchor);
  const results: number[] = [];
  let count = postedCount;
  // Start searching strictly after the last posted date. If nothing posted yet,
  // start one ms before the anchor so the anchor itself is included.
  let cursor = lastPostedAt !== null ? lastPostedAt : anchorDay - 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (rule.end.kind === 'count' && count >= rule.end.n) break;
    const next = nextOccurrenceAfter(rule, cursor);
    if (next === null || next > nowDay) break;
    if (rule.end.kind === 'until' && next > startOfUTCDay(rule.end.date)) break;
    cursor = next;
    if (!skipped.has(next)) {
      results.push(next);
      count++;
    }
  }
  return results;
}

/**
 * Returns the next `limit` occurrence dates that come strictly after `from`
 * (epoch ms), useful for the Planned list and forecast. Never returns posted
 * occurrences — call this with `from = now` to see what's upcoming.
 */
export function upcomingOccurrences(
  series: RecurringSeries,
  from: number,
  limit: number,
): number[] {
  if (series.archived) return [];

  const { rule, postedCount, skippedDates } = series;
  const skipped = new Set(skippedDates);
  const results: number[] = [];
  let count = postedCount;
  let cursor = from;

  while (results.length < limit) {
    if (rule.end.kind === 'count' && count >= rule.end.n) break;
    const next = nextOccurrenceAfter(rule, cursor);
    if (next === null) break;
    if (rule.end.kind === 'until' && next > startOfUTCDay(rule.end.date)) break;
    cursor = next;
    if (!skipped.has(next)) {
      results.push(next);
      count++;
    }
  }
  return results;
}

/**
 * Returns the projected net worth at `until` by adding/subtracting all
 * upcoming scheduled occurrences between `from` and `until` (exclusive) to the
 * actual net worth. Transfers are net-worth-neutral and are excluded.
 */
export function forecastNetWorth(
  actualNetWorth: number,
  allSeries: RecurringSeries[],
  from: number,
  until: number,
  currency: string,
): number {
  let forecast = actualNetWorth;
  for (const series of allSeries) {
    if (series.archived || series.paused) continue;
    if (series.template.currency !== currency) continue;
    const upcoming = upcomingOccurrences(series, from, 10_000);
    for (const date of upcoming) {
      if (date >= until) break;
      const { amount, type } = series.template;
      if (type === 'income') forecast += amount;
      else if (type === 'expense') forecast -= amount;
    }
  }
  return forecast;
}

/**
 * Human-readable label for a recurrence rule, matching the preset names shown
 * in the UI.
 */
export function describeRule(rule: RecurrenceRule): string {
  const { freq, interval } = rule;
  if (freq === 'daily') return interval === 1 ? 'Daily' : `Every ${interval} days`;
  if (freq === 'weekly') {
    if (interval === 1) return 'Weekly';
    if (interval === 2) return 'Every 2 weeks';
    if (interval === 3) return 'Every 3 weeks';
    if (interval === 4) return 'Every 4 weeks';
    return `Every ${interval} weeks`;
  }
  if (freq === 'monthly') {
    if (interval === 1) return 'Monthly';
    if (interval === 2) return 'Every 2 months';
    if (interval === 3) return 'Quarterly';
    if (interval === 6) return 'Semi-annually';
    return `Every ${interval} months`;
  }
  if (freq === 'yearly') return interval === 1 ? 'Annual' : `Every ${interval} years`;
  return 'Custom';
}

/** Short label for the Repeat row in the transaction sheet. */
export function describeRuleShort(rule: RecurrenceRule | null): string {
  if (!rule) return 'Never';
  return describeRule(rule);
}

/**
 * Splits a series at `occurrenceDate` for "this and all future" edits.
 * Returns:
 *  - `truncated`: original series with end set to just before occurrenceDate
 *  - `continuation`: new series starting at occurrenceDate with newRule/newTemplate
 *
 * The caller is responsible for:
 *  - persisting both series in the DB
 *  - updating the edited transaction's seriesId to `continuation.id`
 *  - deleting any already-posted occurrences after occurrenceDate from the DB
 */
export function splitSeriesAt(
  series: RecurringSeries,
  occurrenceDate: number,
  newTemplate: RecurrenceTemplate,
  newRule: RecurrenceRule,
  newSeriesId: string,
  now: number,
): { truncated: RecurringSeries; continuation: RecurringSeries } {
  const cutoff = startOfUTCDay(occurrenceDate) - 1;
  const truncated: RecurringSeries = {
    ...series,
    rule: { ...series.rule, end: { kind: 'until', date: cutoff } },
  };
  const continuation: RecurringSeries = {
    ...series,
    id: newSeriesId,
    rule: { ...newRule, anchor: startOfUTCDay(occurrenceDate) },
    template: newTemplate,
    lastPostedAt: null,
    postedCount: 0,
    skippedDates: [],
    createdAt: now,
  };
  return { truncated, continuation };
}
