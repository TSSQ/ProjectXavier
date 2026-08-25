/**
 * Pure helpers for grouping transactions into day buckets (newest first) with
 * friendly section titles (Today / Yesterday / date). Framework-free.
 */
import { Transaction } from '../domain/types';

export interface DaySection {
  /** Start-of-day epoch ms (avoid the name `key`, reserved by SectionList). */
  dayStart: number;
  title: string;
  data: Transaction[];
}

/**
 * Bucket the ledger into local calendar days, newest first.
 *
 * When `now` is given, every FUTURE-dated row is pulled out into a single
 * leading "Upcoming" section instead of sitting in its own day heading. A
 * scheduled charge under a heading like "SEP 04, 2026", above today, reads as
 * something that already happened; one Upcoming group says what it is.
 *
 * Future means a later local calendar DAY — the same day-granular rule as
 * `isUpcoming`, so a row dated later today stays under Today rather than
 * jumping into Upcoming for a few hours.
 *
 * Upcoming is sorted the opposite way to the rest of the ledger: past days run
 * newest-first because you are looking back, upcoming runs soonest-first
 * because you are looking forward.
 *
 * `now` is optional so the screens that want a plain chronological list
 * (period, account detail) keep their existing behaviour untouched.
 */
export function groupTransactionsByDay(txs: Transaction[], now?: number): DaySection[] {
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  const todayStart = now == null ? null : startOfDay(now);
  const upcoming: Transaction[] = [];
  const rest: Transaction[] = [];
  for (const tx of txs) {
    if (todayStart != null && startOfDay(tx.occurredAt) > todayStart) upcoming.push(tx);
    else rest.push(tx);
  }

  const sorted = [...rest].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt
  );
  const buckets = new Map<number, Transaction[]>();
  for (const tx of sorted) {
    const key = startOfDay(tx.occurredAt);
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }
  const daySections = [...buckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([dayStart, data]) => ({ dayStart, title: dayLabel(dayStart, now), data }));

  if (upcoming.length === 0) return daySections;

  upcoming.sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt);
  return [
    {
      // The soonest upcoming day, so the key stays unique against the day
      // sections below (which are all today or earlier).
      dayStart: startOfDay(upcoming[0]!.occurredAt),
      title: 'Upcoming',
      data: upcoming,
    },
    ...daySections,
  ];
}

/**
 * "Today" / "Yesterday" / an absolute date.
 *
 * `now` must be threaded through from the caller. Reading the real clock here
 * meant `groupTransactionsByDay` honoured its injected clock for the Upcoming
 * split but not for the labels, so the same row could be filed under the day
 * sections by one clock and labelled by another — and the tests only passed on
 * the day they were written.
 */
export function dayLabel(ms: number, now?: number): string {
  const today = now == null ? new Date() : new Date(now);
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (ms === startToday) return 'Today';
  if (ms === startToday - dayMs) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}
