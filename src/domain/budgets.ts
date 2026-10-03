/**
 * Monthly category budgets (docs/design/monthly-budgets-spec.md) — the pure
 * math behind the dashboard card, the Budget screen and the Assistant's
 * afford answer. Framework-free: it takes plain data and returns view models,
 * so the plain-Node BDD suite tests the exact module the app ships.
 *
 * All amounts are integer minor units. A month is a local calendar month,
 * keyed 'YYYY-MM'.
 */
import { Category, RecurringSeries, Transaction, isCounted } from './types';
import { addLocalDays, localDateFormatter, localDayNoon } from './dates';
import { upcomingOccurrences } from './recurrence';
import { currencyExponent } from './currency';

// ─── months ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM'. */
export type MonthKey = string;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: string): boolean => MONTH_RE.test(value);

/** The local calendar month containing `epoch`. */
export function monthKeyOf(epoch: number): MonthKey {
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parts(month: MonthKey): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number);
  return { year: y!, monthIndex: m! - 1 };
}

/** Local midnight at the start of `month`, epoch ms. */
export function monthStart(month: MonthKey): number {
  const { year, monthIndex } = parts(month);
  return new Date(year, monthIndex, 1).getTime();
}

/** Exclusive end of `month` (the next month's start), epoch ms. */
export function monthEnd(month: MonthKey): number {
  const { year, monthIndex } = parts(month);
  return new Date(year, monthIndex + 1, 1).getTime();
}

/** `month` shifted by `delta` calendar months (negative goes back). */
export function addMonths(month: MonthKey, delta: number): MonthKey {
  const { year, monthIndex } = parts(month);
  return monthKeyOf(new Date(year, monthIndex + delta, 1).getTime());
}

export function daysInMonth(month: MonthKey): number {
  const { year, monthIndex } = parts(month);
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** "October" — the month's long name, for labels and the edit sheet's scope. */
export function monthName(month: MonthKey): string {
  const { year, monthIndex } = parts(month);
  return localDateFormatter('en-US|month-long', () =>
    new Intl.DateTimeFormat('en-US', { month: 'long' })
  ).format(new Date(year, monthIndex, 1));
}

/** "Oct" — the short name, for the afford card's label. */
export function monthShortName(month: MonthKey): string {
  const { year, monthIndex } = parts(month);
  return localDateFormatter('en-US|month-short', () =>
    new Intl.DateTimeFormat('en-US', { month: 'short' })
  ).format(new Date(year, monthIndex, 1));
}

/** "October", or "October 2027" when the month is not in `now`'s year; `short`
 *  gives "Oct" / "Oct 2027". */
export function monthLabel(month: MonthKey, now: number, short = false): string {
  const name = short ? monthShortName(month) : monthName(month);
  const year = month.slice(0, 4);
  return year === String(new Date(now).getFullYear()) ? name : `${name} ${year}`;
}

// ─── storage rows and resolution ────────────────────────────────────────────

export interface BudgetRow {
  id: string;
  /** A top-level expense category. */
  categoryId: string;
  /** Minor units; null = "no budget" from `startMonth`. */
  amount: number | null;
  startMonth: MonthKey;
  /** Inclusive; null = open-ended. */
  endMonth: MonthKey | null;
  createdAt: number;
}

/**
 * The budget amount in force for `categoryId` in `month`, or null for none.
 * Among the category's rows covering the month the latest `startMonth` wins,
 * ties going to the latest `createdAt`. A winning row with a null amount means
 * "no budget". 'YYYY-MM' strings sort chronologically, so plain comparison is
 * enough.
 */
export function budgetFor(rows: BudgetRow[], categoryId: string, month: MonthKey): number | null {
  let best: BudgetRow | null = null;
  for (const r of rows) {
    if (r.categoryId !== categoryId) continue;
    if (r.startMonth > month) continue;
    if (r.endMonth !== null && r.endMonth < month) continue;
    if (
      best === null ||
      r.startMonth > best.startMonth ||
      (r.startMonth === best.startMonth && r.createdAt > best.createdAt)
    ) {
      best = r;
    }
  }
  return best?.amount ?? null;
}

/**
 * The ONGOING amount for `categoryId` as of `month`: the open-ended setting that
 * has carried forward, ignoring any one-off ("this month only") row. This is
 * what a chat "raise by 50" builds on, since the write is "onward" and replaces
 * the one-off. Null when no open-ended setting applies or it is a removal.
 */
export function ongoingBudgetFor(rows: BudgetRow[], categoryId: string, month: MonthKey): number | null {
  return budgetFor(
    rows.filter((r) => r.endMonth === null),
    categoryId,
    month
  );
}

export type BudgetScope = 'month' | 'onward';

export interface BudgetWritePlan {
  /** Delete this category's rows with start_month >= this, or null for none. */
  deleteFromMonth: MonthKey | null;
  insert: BudgetRow;
}

/**
 * What a budget write does (spec §3 "Writes"). Month-only inserts
 * start = end = M. Onward first deletes the category's rows starting at or
 * after M (later one-off settings are replaced on purpose), then inserts
 * start = M, open-ended. A zero (or null) amount is "no budget" — Remove —
 * in the same two modes: budget 0 is never stored.
 */
export function planBudgetWrite(args: {
  id: string;
  categoryId: string;
  amount: number | null;
  month: MonthKey;
  scope: BudgetScope;
  now: number;
}): BudgetWritePlan {
  const amount = args.amount === null || args.amount <= 0 ? null : Math.round(args.amount);
  return {
    deleteFromMonth: args.scope === 'onward' ? args.month : null,
    insert: {
      id: args.id,
      categoryId: args.categoryId,
      amount,
      startMonth: args.month,
      endMonth: args.scope === 'month' ? args.month : null,
      createdAt: args.now,
    },
  };
}

// ─── category roll-up ───────────────────────────────────────────────────────

/** The top-level ancestor of `categoryId` (itself when it has no parent).
 *  Guards against a parent cycle and a dangling parent id. */
export function topLevelCategoryId(
  categoryId: string,
  byId: Map<string, Category>
): string | null {
  let current = byId.get(categoryId);
  if (!current) return null;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/** Top-level expense categories — the only ones that can carry a budget. */
export function budgetableCategories(categories: Category[]): Category[] {
  // A child whose parent no longer exists is treated as top-level, so its
  // spend still shows up somewhere (topLevelCategoryId does the same).
  const ids = new Set(categories.map((c) => c.id));
  return categories.filter(
    (c) => c.kind === 'expense' && (!c.parentId || !ids.has(c.parentId))
  );
}

// ─── amounts for a month ────────────────────────────────────────────────────

export type ScheduledKind = 'recurring' | 'future' | 'pending';

export interface ScheduledItem {
  kind: ScheduledKind;
  /** Local-noon (recurring) or the transaction's own date, epoch ms. */
  date: number;
  amount: number;
  /** The posted-or-planned transaction for 'future'/'pending'. */
  txId: string | null;
  seriesId: string | null;
  payeeId: string | null;
  note: string | null;
  /** The category the item was filed under (may be a child of the budget's). */
  categoryId: string;
}

interface Bucket {
  spent: number;
  scheduled: number;
  /** Series-posted spend plus all scheduled: the bills that count from day 1. */
  fixed: number;
  paid: Transaction[];
  items: ScheduledItem[];
}

const emptyBucket = (): Bucket => ({ spent: 0, scheduled: 0, fixed: 0, paid: [], items: [] });

export interface BudgetInputs {
  transactions: Transaction[];
  series: RecurringSeries[];
  categories: Category[];
  rows: BudgetRow[];
  now: number;
  month: MonthKey;
}

/**
 * Refunds: an income transaction filed under an EXPENSE category reduces that
 * category's spend (income in an income category never counts). Returns the
 * signed contribution of a counted transaction to spend, or null when it does
 * not count at all. A negative expense amount reduces spend naturally.
 */
function spendContribution(tx: Transaction, categoryKind: Category['kind']): number | null {
  if (tx.type === 'expense') return tx.amount;
  if (tx.type === 'income' && categoryKind === 'expense') return -tx.amount;
  return null;
}

function bucketsFor(inputs: BudgetInputs): Map<string, Bucket> {
  const { transactions, series, categories, now, month } = inputs;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const buckets = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    let b = buckets.get(id);
    if (!b) {
      b = emptyBucket();
      buckets.set(id, b);
    }
    return b;
  };
  const topOf = (categoryId: string | null | undefined): string | null => {
    if (!categoryId) return null;
    const top = topLevelCategoryId(categoryId, byId);
    return top && byId.get(top)?.kind === 'expense' ? top : null;
  };

  const posted = new Set<string>();
  for (const tx of transactions) {
    if (tx.seriesId && tx.occurrenceDate != null) posted.add(`${tx.seriesId}|${tx.occurrenceDate}`);
  }

  for (const tx of transactions) {
    if (monthKeyOf(tx.occurredAt) !== month) continue;
    const top = topOf(tx.categoryId);
    if (!top) continue;
    const kind = byId.get(tx.categoryId!)!.kind;
    if (isCounted(tx, now)) {
      const delta = spendContribution(tx, kind);
      if (delta === null) continue;
      const b = bucket(top);
      b.spent += delta;
      b.paid.push(tx);
      if (tx.seriesId) b.fixed += delta;
    } else if (tx.type === 'expense') {
      const b = bucket(top);
      b.scheduled += tx.amount;
      b.fixed += tx.amount;
      b.items.push({
        kind: tx.pending ? 'pending' : 'future',
        date: tx.occurredAt,
        amount: tx.amount,
        txId: tx.id,
        seriesId: null,
        payeeId: tx.payeeId ?? null,
        note: tx.note ?? null,
        categoryId: tx.categoryId!,
      });
    }
  }

  // Upcoming occurrences of active series. `from` is yesterday's noon so an
  // occurrence due today that has not been posted yet still counts; anything
  // already posted is matched on (seriesId, occurrenceDate) and skipped.
  const from = addLocalDays(localDayNoon(now), -1);
  const until = monthEnd(month);
  for (const s of series) {
    if (s.paused || s.archived || s.template.type !== 'expense') continue;
    const top = topOf(s.template.categoryId);
    if (!top) continue;
    for (const date of upcomingOccurrences(s, from, 400, until)) {
      if (monthKeyOf(date) !== month || posted.has(`${s.id}|${date}`)) continue;
      const b = bucket(top);
      b.scheduled += s.template.amount;
      b.fixed += s.template.amount;
      b.items.push({
        kind: 'recurring',
        date,
        amount: s.template.amount,
        txId: null,
        seriesId: s.id,
        payeeId: s.template.payeeId ?? null,
        note: s.template.note ?? null,
        categoryId: s.template.categoryId!,
      });
    }
  }
  return buckets;
}

// ─── view models ────────────────────────────────────────────────────────────

export type BudgetState = 'ok' | 'warn' | 'over';

export interface CategoryBudget {
  categoryId: string;
  budget: number;
  spent: number;
  scheduled: number;
  committed: number;
  left: number;
  fixed: number;
  /** Where an even pace would put the category today; null outside the
   *  current month. */
  target: number | null;
  state: BudgetState;
  /** How far along relative to today's target, committed ÷ target; falls back
   *  to committed ÷ budget when there is no pace. Drives attention order. */
  ratio: number;
  /** Today's tick on the bar, as a 0..1 share of the budget; null when no pace. */
  tick: number | null;
  paid: Transaction[];
  items: ScheduledItem[];
}

export type OverallChip = 'On pace' | 'A little ahead of pace' | 'Ahead of pace' | 'Over budget';

export interface BudgetSummary {
  month: MonthKey;
  /** The month is the current local month, so pace figures apply. */
  isCurrent: boolean;
  budget: number;
  spent: number;
  scheduled: number;
  committed: number;
  left: number;
  fixed: number;
  target: number | null;
  tick: number | null;
  chip: OverallChip | null;
  chipState: BudgetState | null;
  /** N − d in the current month, else null. */
  daysLeft: number | null;
  /** Whole minor units of left ÷ days left; null when none applies (not the
   *  current month, last day, or nothing left). */
  perDay: number | null;
  lastDay: boolean;
  /** Budgeted categories in attention order. */
  categories: CategoryBudget[];
  /** Spend in categories with no budget this month, largest first. */
  notBudgeted: Array<{ categoryId: string; amount: number }>;
}

function flexibleUsed(committed: number, fixed: number, budget: number): boolean {
  const flex = budget - fixed;
  return flex > 0 && committed - fixed >= 0.85 * flex;
}

function classify(committed: number, fixed: number, budget: number, target: number | null): BudgetState {
  if (committed > budget) return 'over';
  if (flexibleUsed(committed, fixed, budget)) return 'warn';
  if (target !== null && committed > target + 0.05 * budget) return 'warn';
  return 'ok';
}

const RANK: Record<BudgetState, number> = { over: 0, warn: 1, ok: 2 };

/** Attention order (spec §4.4): over by overage, then warn, then ok, each by
 *  pace ratio, highest first. */
function byAttention(a: CategoryBudget, b: CategoryBudget, name: (id: string) => string): number {
  if (a.state !== b.state) return RANK[a.state] - RANK[b.state];
  if (a.state === 'over') {
    const diff = b.committed - b.budget - (a.committed - a.budget);
    if (diff !== 0) return diff;
  } else if (b.ratio !== a.ratio) {
    return b.ratio - a.ratio;
  }
  return name(a.categoryId).localeCompare(name(b.categoryId));
}

/** Everything the budget surfaces show for one month. */
export function computeBudgets(inputs: BudgetInputs): BudgetSummary {
  const { categories, rows, now, month } = inputs;
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const isCurrent = monthKeyOf(now) === month;
  const dayOfMonth = new Date(now).getDate();
  const n = daysInMonth(month);
  const f = isCurrent ? dayOfMonth / n : null;
  const buckets = bucketsFor(inputs);

  const views: CategoryBudget[] = [];
  const notBudgeted: Array<{ categoryId: string; amount: number }> = [];
  for (const cat of budgetableCategories(categories)) {
    const b = buckets.get(cat.id) ?? emptyBucket();
    const budget = budgetFor(rows, cat.id, month);
    if (budget === null) {
      const amount = Math.max(0, b.spent) + b.scheduled;
      if (amount > 0) notBudgeted.push({ categoryId: cat.id, amount });
      continue;
    }
    const spent = Math.max(0, b.spent);
    const committed = spent + b.scheduled;
    const fixed = Math.min(b.fixed, committed);
    const target = f === null ? null : fixed + (budget - fixed) * f;
    views.push({
      categoryId: cat.id,
      budget,
      spent,
      scheduled: b.scheduled,
      committed,
      left: budget - committed,
      fixed,
      target,
      state: classify(committed, fixed, budget, target),
      ratio: target !== null && target > 0 ? committed / target : committed / budget,
      tick: target === null ? null : target / budget,
      paid: b.paid,
      items: b.items,
    });
  }
  views.sort((a, b) => byAttention(a, b, nameOf));
  notBudgeted.sort((a, b) => b.amount - a.amount || nameOf(a.categoryId).localeCompare(nameOf(b.categoryId)));

  const sum = (pick: (v: CategoryBudget) => number) => views.reduce((t, v) => t + pick(v), 0);
  const budget = sum((v) => v.budget);
  const spent = sum((v) => v.spent);
  const scheduled = sum((v) => v.scheduled);
  const committed = spent + scheduled;
  const fixed = sum((v) => v.fixed);
  const target = f === null ? null : sum((v) => v.target ?? 0);
  const left = budget - committed;

  let chip: OverallChip | null = null;
  let chipState: BudgetState | null = null;
  if (target !== null && budget > 0) {
    if (committed > budget) [chip, chipState] = ['Over budget', 'over'];
    else if (committed <= target) [chip, chipState] = ['On pace', 'ok'];
    else if (committed <= target + 0.1 * budget) [chip, chipState] = ['A little ahead of pace', 'warn'];
    else [chip, chipState] = ['Ahead of pace', 'warn'];
  }

  const daysLeft = isCurrent ? n - dayOfMonth : null;
  const lastDay = daysLeft === 0;
  const perDay =
    daysLeft !== null && daysLeft > 0 && left > 0 ? Math.round(left / daysLeft) : null;

  return {
    month,
    isCurrent,
    budget,
    spent,
    scheduled,
    committed,
    left,
    fixed,
    target,
    tick: target !== null && budget > 0 ? target / budget : null,
    chip,
    chipState,
    daysLeft,
    perDay,
    lastDay,
    categories: views,
    notBudgeted,
  };
}

/** The dashboard's list: the first 3 in attention order, plus the footer count
 *  ("+ N more on track" when the rest are all ok, else "+ N more"). */
export function dashboardRows(summary: BudgetSummary): {
  rows: CategoryBudget[];
  moreCount: number;
  moreAllOk: boolean;
} {
  const rows = summary.categories.slice(0, 3);
  const rest = summary.categories.slice(3);
  return { rows, moreCount: rest.length, moreAllOk: rest.every((v) => v.state === 'ok') };
}

// ─── suggestions ────────────────────────────────────────────────────────────

export interface BudgetSuggestion {
  categoryId: string;
  /** 3-month average, rounded to the nearest 10 major units (half up). */
  amount: number;
  /** Averages of 50 major units or more start ticked. */
  ticked: boolean;
}

const SUGGESTION_STEP_MAJOR = 10;
const SUGGESTION_TICK_MAJOR = 50;

/** Rounds `minor` to the nearest 10 major units, half up. */
function roundToStep(minor: number, exponent: number): number {
  const step = SUGGESTION_STEP_MAJOR * 10 ** exponent;
  return Math.floor(minor / step + 0.5) * step;
}

/** Counted spend per top-level expense category over the 3 full calendar
 *  months before `month`, divided by 3 and rounded. */
export function threeMonthAverages(
  inputs: Pick<BudgetInputs, 'transactions' | 'categories' | 'now' | 'month'>,
  currency = 'USD'
): Map<string, number> {
  const exponent = currencyExponent(currency);
  const totals = new Map<string, number>();
  for (let back = 1; back <= 3; back++) {
    const buckets = bucketsFor({
      transactions: inputs.transactions,
      categories: inputs.categories,
      now: inputs.now,
      month: addMonths(inputs.month, -back),
      series: [],
      rows: [],
    });
    for (const [id, b] of buckets) totals.set(id, (totals.get(id) ?? 0) + Math.max(0, b.spent));
  }
  const averages = new Map<string, number>();
  for (const [id, total] of totals) averages.set(id, roundToStep(total / 3, exponent));
  return averages;
}

/** First-run list: every top-level expense category with an average above 0,
 *  largest first. Empty when there is no spend in the 3 months. */
export function suggestBudgets(
  inputs: Pick<BudgetInputs, 'transactions' | 'categories' | 'now' | 'month'>,
  currency = 'USD'
): BudgetSuggestion[] {
  const averages = threeMonthAverages(inputs, currency);
  const tick = SUGGESTION_TICK_MAJOR * 10 ** currencyExponent(currency);
  const names = new Map(inputs.categories.map((c) => [c.id, c.name]));
  return budgetableCategories(inputs.categories)
    .map((c) => ({ categoryId: c.id, amount: averages.get(c.id) ?? 0 }))
    .filter((s) => s.amount > 0)
    .sort((a, b) => b.amount - a.amount || (names.get(a.categoryId) ?? '').localeCompare(names.get(b.categoryId) ?? ''))
    .map((s) => ({ ...s, ticked: s.amount >= tick }));
}

// ─── afford ─────────────────────────────────────────────────────────────────

export interface AffordResult {
  verdict: 'fits' | 'over';
  leftNow: number;
  after: number;
  /** All budgets' left, less the purchase — shown only when over and > 0. */
  overallLeftAfter: number;
}

/**
 * "Can I afford `amount`?" against one category's budget or all budgets
 * together (current month). null when the category has no budget.
 */
export type AffordScope = { kind: 'all' } | { kind: 'category'; categoryId: string };

export function affordAnswer(
  amount: number,
  scope: AffordScope,
  summary: BudgetSummary
): AffordResult | null {
  const leftNow =
    scope.kind === 'all'
      ? summary.left
      : summary.categories.find((v) => v.categoryId === scope.categoryId)?.left;
  if (leftNow === undefined) return null;
  const after = leftNow - amount;
  return {
    verdict: after >= 0 ? 'fits' : 'over',
    leftNow,
    after,
    overallLeftAfter: summary.left - amount,
  };
}

// ─── dashboard card ─────────────────────────────────────────────────────────

/** The overall bar's fill: primary, or negative once the month is over budget.
 *  (The pace chip carries "ahead of pace" in words; the bar stays primary.) */
export function barState(summary: BudgetSummary): BudgetState {
  return summary.left < 0 ? 'over' : 'ok';
}

export type BudgetCardKind = 'card' | 'setup' | 'hidden';

/**
 * Whether the dashboard shows the budget card (spec §5.1). Only a single-month
 * period qualifies — a year or a custom range is hidden. With no budget set
 * the current month gets the compact setup card and any other month shows
 * nothing. The account filter never changes this: the card ignores it.
 */
export function budgetCardKind(
  periodMode: 'month' | 'year' | 'date',
  summary: BudgetSummary
): BudgetCardKind {
  if (periodMode !== 'month') return 'hidden';
  if (summary.categories.length > 0) return 'card';
  return summary.isCurrent ? 'setup' : 'hidden';
}
