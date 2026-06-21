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

export function groupTransactionsByDay(txs: Transaction[]): DaySection[] {
  const sorted = [...txs].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt
  );
  const buckets = new Map<number, Transaction[]>();
  for (const tx of sorted) {
    const d = new Date(tx.occurredAt);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([dayStart, data]) => ({ dayStart, title: dayLabel(dayStart), data }));
}

export function dayLabel(ms: number): string {
  const today = new Date();
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
