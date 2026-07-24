/**
 * The Ask-Xavier read-only tool belt (docs/design/ask-xavier-queries-spec.md
 * §5.2) — seven pure, framework-free tools over already-loaded data
 * (accounts/transactions/categories/payees, the same grounding shape the
 * parse engines already load). "The model plans; deterministic code
 * computes": every number a tool returns comes from this file's own math over
 * `src/domain/balances.ts`/`period.ts`, never from a model.
 *
 * Every tool's `category`/`payee`/`account` params are free-text NAME
 * STRINGS — the model (BYOK tool loop or FM's single-shot selection) never
 * sees or invents a real id, only proposes a name copied from the user's
 * words, exactly like the expense/account parse contracts. This module
 * ALWAYS re-resolves that name through the existing matchers
 * (`findCategoryMatch`/`findPayeeMatch`/`findAccountMatch`) before filtering
 * anything. A name that doesn't resolve to a real entity is NEVER silently
 * dropped into a zero-result filter — the tool runs UNFILTERED for that
 * dimension and appends a human-readable note to the result's `notes` array,
 * so the calling card can say "couldn't find 'X' — showing all" instead of a
 * silent (and misleading) zero.
 *
 * Transfers are excluded from every spend/income aggregate by construction —
 * each executor below filters on `tx.type === 'expense'`/`'income'`
 * explicitly, so a transfer between the user's own accounts (which is
 * neither spending nor earning) never inflates either total.
 */
import { Account, Category, Payee, Transaction, isCounted } from './types';
import { inRange, startOfPeriod, endOfPeriod } from './period';
import { resolvePeriodRange, PeriodToken, PERIOD_TOKENS } from './periodRange';
import { netWorth, netWorthAsOf } from './balances';
import { findCategoryMatch } from './categories';
import { findPayeeMatch } from './payees';
import { findAccountMatch } from './accountMatch';
import { formatDMY, monthLabel } from './dates';
import { z } from 'zod';
import { zodSchema } from 'ai';

export const QUERY_TOOL_NAMES = [
  'total_spent',
  'total_income',
  'spending_by_category',
  'spending_over_time',
  'top_payees',
  'net_worth',
  'search_transactions',
] as const;

export type QueryToolName = (typeof QUERY_TOOL_NAMES)[number];

export type SeriesGranularity = 'day' | 'week' | 'month';

/** Everything a tool executor needs — loaded ONCE by the caller (the same
 *  "load once, use many times" shape `runParse` already uses for the parse
 *  engines' grounding data). */
export interface QueryToolContext {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  payees: Payee[];
  /** Device clock (ms since epoch) — injected, never read via `Date.now()`
   *  inside this module (mirrors every other domain module's convention). */
  now: number;
}

// ─── Per-tool params (post-normalization — see queryToolSelection.ts for the
// raw model-facing schema, and queryLoop.ts for the BYOK native tool-call
// JSON schemas built from these shapes) ────────────────────────────────────

export interface TotalSpentParams {
  period: PeriodToken;
  category?: string;
  payee?: string;
  account?: string;
}
export interface TotalIncomeParams {
  period: PeriodToken;
  category?: string;
}
export interface SpendingByCategoryParams {
  period: PeriodToken;
}
export interface SpendingOverTimeParams {
  period: PeriodToken;
  granularity: SeriesGranularity;
  category?: string;
}
export interface TopPayeesParams {
  period: PeriodToken;
  /** 1-10 — callers should clamp before this point; executor clamps again as
   *  a belt-and-braces guard. */
  n: number;
}
export interface NetWorthParams {
  /** When set, the point-in-time balance as of the END of this period
   *  (mutually exclusive with `series` in practice, but both may be
   *  supplied — `series` wins). Omitted = "right now". */
  asOf?: PeriodToken;
  series?: boolean;
}
export interface SearchTransactionsParams {
  period: PeriodToken;
  category?: string;
  payee?: string;
  account?: string;
  /** 1-20 — clamped by the executor. */
  limit: number;
}

export type QueryToolCall =
  | { tool: 'total_spent'; params: TotalSpentParams }
  | { tool: 'total_income'; params: TotalIncomeParams }
  | { tool: 'spending_by_category'; params: SpendingByCategoryParams }
  | { tool: 'spending_over_time'; params: SpendingOverTimeParams }
  | { tool: 'top_payees'; params: TopPayeesParams }
  | { tool: 'net_worth'; params: NetWorthParams }
  | { tool: 'search_transactions'; params: SearchTransactionsParams };

// ─── Results ────────────────────────────────────────────────────────────────

/** Shared by every tool: human-readable "couldn't resolve X, showing all"
 *  notes — empty when every named filter resolved cleanly (or none were
 *  given). Cards render this as a small caption under the number/chart. */
export interface ToolNotes {
  notes: string[];
}

export interface TotalSpentResult extends ToolNotes {
  amountMinor: number;
  count: number;
}
export interface TotalIncomeResult extends ToolNotes {
  amountMinor: number;
  count: number;
}
export interface CategorySlice {
  categoryId: string | null;
  name: string;
  amountMinor: number;
}
export interface SpendingByCategoryResult extends ToolNotes {
  slices: CategorySlice[];
}
export interface SeriesPoint {
  label: string;
  amountMinor: number;
}
export interface SpendingOverTimeResult extends ToolNotes {
  series: SeriesPoint[];
}
export interface PayeeRow {
  payeeId: string | null;
  name: string;
  amountMinor: number;
  count: number;
}
export interface TopPayeesResult extends ToolNotes {
  rows: PayeeRow[];
}
export interface NetWorthResult extends ToolNotes {
  amountMinor?: number;
  series?: SeriesPoint[];
}
export interface TransactionRowResult {
  id: string;
  type: Transaction['type'];
  amountMinor: number;
  occurredAt: number;
  categoryName: string | null;
  payeeName: string | null;
  accountName: string | null;
  note: string | null;
}
export interface SearchTransactionsResult extends ToolNotes {
  rows: TransactionRowResult[];
}

// ─── Name-resolution helpers — the "unresolvable name -> unfiltered + flagged,
// never silent-zero" rule (spec §5.2), shared by every tool below. ─────────

interface Resolved {
  id: string | null;
  note: string | null;
}

function resolveCategory(
  name: string | undefined,
  kind: 'expense' | 'income',
  categories: Category[]
): Resolved {
  if (!name) return { id: null, note: null };
  const match = findCategoryMatch(name, kind, categories);
  if (match.exact) return { id: match.exact.id, note: null };
  return { id: null, note: `couldn't find category "${name}" — showing all` };
}

function resolvePayee(name: string | undefined, payees: Payee[]): Resolved {
  if (!name) return { id: null, note: null };
  const match = findPayeeMatch(name, payees);
  if (match.exact) return { id: match.exact.id, note: null };
  return { id: null, note: `couldn't find payee "${name}" — showing all` };
}

function resolveAccount(name: string | undefined, accounts: Account[]): Resolved {
  if (!name) return { id: null, note: null };
  const match = findAccountMatch(name, accounts);
  if (match?.account) return { id: match.account.id, note: null };
  return { id: null, note: `couldn't find account "${name}" — showing all` };
}

function categoryName(categoryId: string | null | undefined, categories: Category[]): string | null {
  if (!categoryId) return null;
  return categories.find((c) => c.id === categoryId)?.name ?? null;
}

function payeeName(payeeId: string | null | undefined, payees: Payee[]): string | null {
  if (!payeeId) return null;
  return payees.find((p) => p.id === payeeId)?.name ?? null;
}

function accountName(accountId: string | null | undefined, accounts: Account[]): string | null {
  if (!accountId) return null;
  return accounts.find((a) => a.id === accountId)?.name ?? null;
}

/**
 * Clamp `n` into `[min, max]`, rounding to the nearest integer — but a
 * non-finite `n` (NaN, +/-Infinity — e.g. a malformed BYOK tool call's `n`/
 * `limit` that slipped past validation) falls back to `fallback` instead of
 * propagating NaN. Without this, `clamp(NaN, 1, 10)` is NaN and
 * `rows.slice(0, NaN)` silently returns `[]` — a silent-empty result even
 * though real data exists, the exact "never silent-zero" violation this
 * module's own header forbids for name-resolution (QA MAJOR follow-up:
 * numeric params need the same guarantee).
 */
function clamp(n: number, min: number, max: number, fallback: number = min): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ─── Executors ──────────────────────────────────────────────────────────────

export function totalSpent(ctx: QueryToolContext, params: TotalSpentParams): TotalSpentResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  const category = resolveCategory(params.category, 'expense', ctx.categories);
  const payee = resolvePayee(params.payee, ctx.payees);
  const account = resolveAccount(params.account, ctx.accounts);
  const notes = [category.note, payee.note, account.note].filter((n): n is string => !!n);

  let amountMinor = 0;
  let count = 0;
  for (const tx of ctx.transactions) {
    if (tx.type !== 'expense' || !isCounted(tx) || !inRange(tx, range)) continue;
    if (category.id && tx.categoryId !== category.id) continue;
    if (payee.id && tx.payeeId !== payee.id) continue;
    if (account.id && tx.accountId !== account.id) continue;
    amountMinor += tx.amount;
    count++;
  }
  return { amountMinor, count, notes };
}

export function totalIncome(ctx: QueryToolContext, params: TotalIncomeParams): TotalIncomeResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  const category = resolveCategory(params.category, 'income', ctx.categories);
  const notes = [category.note].filter((n): n is string => !!n);

  let amountMinor = 0;
  let count = 0;
  for (const tx of ctx.transactions) {
    if (tx.type !== 'income' || !isCounted(tx) || !inRange(tx, range)) continue;
    if (category.id && tx.categoryId !== category.id) continue;
    amountMinor += tx.amount;
    count++;
  }
  return { amountMinor, count, notes };
}

export function spendingByCategory(
  ctx: QueryToolContext,
  params: SpendingByCategoryParams
): SpendingByCategoryResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  const byCategory = new Map<string | null, number>();
  for (const tx of ctx.transactions) {
    if (tx.type !== 'expense' || !isCounted(tx) || !inRange(tx, range)) continue;
    const key = tx.categoryId ?? null;
    byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amount);
  }
  const slices: CategorySlice[] = [...byCategory.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      name: categoryName(categoryId, ctx.categories) ?? 'Uncategorized',
      amountMinor,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  return { slices, notes: [] };
}

/** Bucket label for a period start, matching each granularity's natural
 *  reading — day/week buckets show their start date, month buckets show
 *  "Month Year" (reuses src/domain/dates.ts, no new date formatting rules). */
function bucketLabel(start: number, granularity: SeriesGranularity): string {
  return granularity === 'month' ? monthLabel(start) : formatDMY(start);
}

const KNOWN_SERIES_GRANULARITIES = new Set<string>(['day', 'week', 'month']);

/** Defends against an out-of-enum granularity reaching `startOfPeriod`/
 *  `endOfPeriod` at runtime (QA BLOCKER follow-up — e.g. a malformed BYOK
 *  tool call's `granularity: "fortnight"`, which `endOfPeriod`'s
 *  unknown-granularity fallback returns UNCHANGED, so the bucket-loop cursor
 *  below would never advance -> an infinite loop). `params.granularity` is
 *  typed `SeriesGranularity` at the TS level, but this executor may be
 *  called with data that only PASSED validation at a call site's own
 *  boundary (or, in the future, none at all) — never trust the type alone
 *  for something with a real DoS consequence. Falls back to 'day', the
 *  finest (and so safest/most information-preserving) granularity. */
function sanitizeGranularity(granularity: SeriesGranularity): SeriesGranularity {
  return KNOWN_SERIES_GRANULARITIES.has(granularity) ? granularity : 'day';
}

/** Hard cap on the number of buckets any series-building loop below may
 *  produce, independent of whether `endOfPeriod` correctly advances its
 *  cursor — defense in depth (QA BLOCKER follow-up) against ANY future
 *  cursor-doesn't-advance bug, not just the known granularity case above.
 *  750 comfortably covers daily buckets across a multi-year `all_time`
 *  range while still being a trivially fast loop bound. */
const MAX_SERIES_BUCKETS = 750;

export function spendingOverTime(
  ctx: QueryToolContext,
  params: SpendingOverTimeParams
): SpendingOverTimeResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  const granularity = sanitizeGranularity(params.granularity);
  const category = resolveCategory(params.category, 'expense', ctx.categories);
  const notes = [category.note].filter((n): n is string => !!n);

  const buckets = new Map<number, number>();
  for (const tx of ctx.transactions) {
    if (tx.type !== 'expense' || !isCounted(tx) || !inRange(tx, range)) continue;
    if (category.id && tx.categoryId !== category.id) continue;
    const key = startOfPeriod(tx.occurredAt, granularity);
    buckets.set(key, (buckets.get(key) ?? 0) + tx.amount);
  }

  const series: SeriesPoint[] = [];
  let cursor = startOfPeriod(range.start, granularity);
  let bucketGuard = 0;
  while (cursor < range.end && bucketGuard++ < MAX_SERIES_BUCKETS) {
    series.push({
      label: bucketLabel(cursor, granularity),
      amountMinor: buckets.get(cursor) ?? 0,
    });
    const next = endOfPeriod(cursor, granularity);
    if (next <= cursor) break; // cursor failed to advance — stop rather than spin
    cursor = next;
  }
  return { series, notes };
}

export function topPayees(ctx: QueryToolContext, params: TopPayeesParams): TopPayeesResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  // A non-finite `n` (e.g. NaN from a malformed tool call) defaults to 5
  // rather than clamping to 0 rows — never silent-zero (see clamp's header).
  const n = clamp(params.n, 1, 10, 5);
  const byPayee = new Map<string | null, { amountMinor: number; count: number }>();
  for (const tx of ctx.transactions) {
    if (tx.type !== 'expense' || !isCounted(tx) || !inRange(tx, range)) continue;
    const key = tx.payeeId ?? null;
    const agg = byPayee.get(key) ?? { amountMinor: 0, count: 0 };
    agg.amountMinor += tx.amount;
    agg.count += 1;
    byPayee.set(key, agg);
  }
  const rows: PayeeRow[] = [...byPayee.entries()]
    .map(([payeeId, agg]) => ({
      payeeId,
      name: payeeName(payeeId, ctx.payees) ?? 'Unknown',
      ...agg,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, n);
  return { rows, notes: [] };
}

/** Sample points for a net-worth trend — one per calendar month across
 *  `range`, each the balance as of that month's end. Mirrors
 *  `balances.ts`'s `balanceSeries` idea, summed across every account instead
 *  of one. */
function netWorthSeries(ctx: QueryToolContext, range: { start: number; end: number }): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  let cursor = startOfPeriod(range.start, 'month');
  let bucketGuard = 0;
  while (cursor < range.end && bucketGuard++ < MAX_SERIES_BUCKETS) {
    const monthEnd = endOfPeriod(cursor, 'month') - 1;
    points.push({
      label: monthLabel(cursor),
      amountMinor: netWorthAsOf(ctx.accounts, ctx.transactions, Math.min(monthEnd, range.end - 1)),
    });
    const next = endOfPeriod(cursor, 'month');
    if (next <= cursor) break; // cursor failed to advance — stop rather than spin
    cursor = next;
  }
  return points;
}

export function netWorthTool(ctx: QueryToolContext, params: NetWorthParams): NetWorthResult {
  if (params.series) {
    const range = params.asOf
      ? resolvePeriodRange(params.asOf, ctx.now)
      : resolvePeriodRange('last_year', ctx.now);
    return { series: netWorthSeries(ctx, range), notes: [] };
  }
  if (params.asOf) {
    const range = resolvePeriodRange(params.asOf, ctx.now);
    return { amountMinor: netWorthAsOf(ctx.accounts, ctx.transactions, range.end - 1), notes: [] };
  }
  return { amountMinor: netWorth(ctx.accounts, ctx.transactions), notes: [] };
}

export function searchTransactions(
  ctx: QueryToolContext,
  params: SearchTransactionsParams
): SearchTransactionsResult {
  const range = resolvePeriodRange(params.period, ctx.now);
  // search spans every transaction type (spec §5.2 — no `expense`-only
  // filter here, unlike the aggregate tools above), so category/payee
  // filters still apply when present but aren't scoped to a single kind.
  const category = params.category
    ? findCategoryMatch(params.category, 'expense', ctx.categories).exact ??
      findCategoryMatch(params.category, 'income', ctx.categories).exact
    : undefined;
  const payee = resolvePayee(params.payee, ctx.payees);
  const account = resolveAccount(params.account, ctx.accounts);
  const notes = [
    params.category && !category ? `couldn't find category "${params.category}" — showing all` : null,
    payee.note,
    account.note,
  ].filter((n): n is string => !!n);

  // A non-finite `limit` (e.g. NaN) defaults to 10 rather than clamping to 0
  // rows — never silent-zero (see clamp's header).
  const limit = clamp(params.limit, 1, 20, 10);
  const rows: TransactionRowResult[] = ctx.transactions
    .filter((tx) => isCounted(tx) && inRange(tx, range))
    .filter((tx) => !category || tx.categoryId === category.id)
    .filter((tx) => !payee.id || tx.payeeId === payee.id)
    .filter((tx) => !account.id || tx.accountId === account.id || tx.transferAccountId === account.id)
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, limit)
    .map((tx) => ({
      id: tx.id,
      type: tx.type,
      amountMinor: tx.amount,
      occurredAt: tx.occurredAt,
      categoryName: categoryName(tx.categoryId, ctx.categories),
      payeeName: payeeName(tx.payeeId, ctx.payees),
      accountName: accountName(tx.accountId, ctx.accounts),
      note: tx.note ?? null,
    }));
  return { rows, notes };
}

/** Single dispatch point — the shape both `src/domain/queryToolSelection.ts`
 *  (FM) and `src/features/ai/queryLoop.ts` (BYOK) call into, so neither has
 *  to know each tool's individual export name. Returns `null` for a
 *  `QueryToolCall` this module doesn't recognise (defensive only — every
 *  member of `QUERY_TOOL_NAMES` is handled below). */
export function executeQueryTool(ctx: QueryToolContext, call: QueryToolCall): unknown {
  switch (call.tool) {
    case 'total_spent':
      return totalSpent(ctx, call.params);
    case 'total_income':
      return totalIncome(ctx, call.params);
    case 'spending_by_category':
      return spendingByCategory(ctx, call.params);
    case 'spending_over_time':
      return spendingOverTime(ctx, call.params);
    case 'top_payees':
      return topPayees(ctx, call.params);
    case 'net_worth':
      return netWorthTool(ctx, call.params);
    case 'search_transactions':
      return searchTransactions(ctx, call.params);
    default:
      return null;
  }
}

// ─── BYOK native tool-use definitions (src/features/ai/queryLoop.ts) ───────
// Proper (optional-field) zod schemas — unlike the expense/account CREATE
// schemas, these only ever feed the BYOK cloud providers' native tool-calling
// APIs (never `generateObject`/FM), so there's no on-device JSON-schema
// converter limitation to work around: optional fields are fine here, and
// nothing needs a sentinel value. `queryToolSelection.ts`'s single-shot FM
// contract is a SEPARATE, flatter schema (see that file's header for why).

const periodParam = z
  .enum(PERIOD_TOKENS)
  .describe(
    'The time period to cover: this_month, last_month, this_week, last_week, this_year, last_year, or all_time.'
  );

export const TOTAL_SPENT_PARAMS = z.object({
  period: periodParam,
  category: z.string().optional().describe('Optional category name to filter by, copied from the user\'s own words.'),
  payee: z.string().optional().describe("Optional payee/merchant name to filter by, copied from the user's own words."),
  account: z.string().optional().describe("Optional account name to filter by, copied from the user's own words."),
});

export const TOTAL_INCOME_PARAMS = z.object({
  period: periodParam,
  category: z.string().optional().describe('Optional category name to filter by.'),
});

export const SPENDING_BY_CATEGORY_PARAMS = z.object({
  period: periodParam,
});

export const SPENDING_OVER_TIME_PARAMS = z.object({
  period: periodParam,
  granularity: z.enum(['day', 'week', 'month']).describe('The bucket size for the trend.'),
  category: z.string().optional().describe('Optional category name to filter by.'),
});

export const TOP_PAYEES_PARAMS = z.object({
  period: periodParam,
  n: z.number().int().min(1).max(10).describe('How many payees to return (1-10).'),
});

export const NET_WORTH_PARAMS = z.object({
  asOf: periodParam.optional().describe('Optional — report the balance as of the END of this period instead of right now.'),
  series: z.boolean().optional().describe('True to return a month-by-month trend instead of one point value.'),
});

export const SEARCH_TRANSACTIONS_PARAMS = z.object({
  period: periodParam,
  category: z.string().optional().describe('Optional category name to filter by.'),
  payee: z.string().optional().describe('Optional payee/merchant name to filter by.'),
  account: z.string().optional().describe('Optional account name to filter by.'),
  limit: z.number().int().min(1).max(20).describe('Maximum number of transactions to return (1-20).'),
});

/** One entry per `QUERY_TOOL_NAMES` member — name, description, zod params,
 *  and the derived JSON Schema (`zodSchema(...).jsonSchema`, the same
 *  conversion every other contract in this codebase uses) — the single
 *  source `queryLoop.ts` builds BOTH providers' native tool definitions
 *  from, so the two can never drift apart from each other or from the
 *  executor's own params types above. */
export const QUERY_TOOL_DEFS: ReadonlyArray<{
  name: QueryToolName;
  description: string;
  params: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
}> = [
  {
    name: 'total_spent',
    description: 'Total amount spent (expenses only) in a period, optionally filtered by category, payee, or account.',
    params: TOTAL_SPENT_PARAMS,
    jsonSchema: zodSchema(TOTAL_SPENT_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'total_income',
    description: 'Total amount of income received in a period, optionally filtered by category.',
    params: TOTAL_INCOME_PARAMS,
    jsonSchema: zodSchema(TOTAL_INCOME_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'spending_by_category',
    description: 'Spending broken down by category for a period — use for "where did my money go" / breakdown questions.',
    params: SPENDING_BY_CATEGORY_PARAMS,
    jsonSchema: zodSchema(SPENDING_BY_CATEGORY_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'spending_over_time',
    description: 'Spending bucketed over time (day/week/month) for a period, optionally filtered by category — use for trend/chart questions.',
    params: SPENDING_OVER_TIME_PARAMS,
    jsonSchema: zodSchema(SPENDING_OVER_TIME_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'top_payees',
    description: 'The payees/merchants with the highest total spend in a period.',
    params: TOP_PAYEES_PARAMS,
    jsonSchema: zodSchema(TOP_PAYEES_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'net_worth',
    description: 'Current or historical net worth (sum of every account balance) — a single point value, or a trend series.',
    params: NET_WORTH_PARAMS,
    jsonSchema: zodSchema(NET_WORTH_PARAMS).jsonSchema as Record<string, unknown>,
  },
  {
    name: 'search_transactions',
    description: 'Find individual transactions in a period, optionally filtered by category, payee, or account.',
    params: SEARCH_TRANSACTIONS_PARAMS,
    jsonSchema: zodSchema(SEARCH_TRANSACTIONS_PARAMS).jsonSchema as Record<string, unknown>,
  },
];
