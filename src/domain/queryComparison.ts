/**
 * Deterministic comparison-chart detector for BYOK multi-call answers
 * (docs/design/ask-xavier-queries-spec.md §5.3/§5.4) — device bug (build
 * 58): "compare my spending in 2025 vs 2026" made the BYOK tool loop do the
 * RIGHT thing (two `total_spent` calls, one per year — 2025 -> SGD 0.00,
 * 2026 -> SGD 150.00 — with a narration that genuinely reads the
 * comparison), but `app/(tabs)/index.tsx` only ever rendered
 * `calls[calls.length - 1]` (see that file's former "v1 limitation"
 * comment). The card showed a single "Total spent SGD 150.00" — the
 * comparison survived only in the model's own (untrusted, display-only)
 * narration text, never in the authoritative card.
 *
 * `buildQueryComparison` looks at the ALREADY-EXECUTED tool calls
 * (`QueryLoopResult.calls`) and, only when they form a genuine same-tool,
 * different-period, single-scalar-amount comparison, returns a small
 * chartable series — one entry per distinct period, its `amountMinor` read
 * straight from that call's own `result` (never from the narration, never
 * recomputed). Every other shape (a single call, mixed tools, a
 * non-scalar tool like `spending_by_category`/`spending_over_time`/
 * `top_payees`/`search_transactions`, or calls that all share the same
 * period) returns `null` so the caller falls back to today's
 * single-result card unchanged — comparing breakdowns/rank-lists/trend
 * series against each other is out of scope for v1 (documented gap, not an
 * oversight: there's no single number to put on one bar for those tools).
 *
 * Pure, framework-free, `now`-free: reads only the calls it's given, never
 * `Date.now()`, never re-executes a tool.
 */
import { QueryToolName } from './queryTools';
import { PeriodSpec, periodKey } from './periodRange';
import { periodChartLabel } from './queryCaption';

/**
 * The minimal shape this module needs from a completed tool call —
 * structurally identical to `src/features/ai/queryLoop.ts`'s
 * `QueryLoopToolCall`, but declared locally so this domain module never
 * imports from `features/ai` (matches every other pure domain module's
 * dependency direction — domain modules are never callers of a feature
 * module). Any real `QueryLoopToolCall[]` array satisfies this by
 * structural typing.
 */
export interface ComparisonToolCall {
  tool: QueryToolName;
  params: Record<string, unknown>;
  result: unknown;
}

/** Tools this module treats as "a single scalar amount" comparable across
 *  periods — see the module header's scope note. `net_worth` only counts
 *  in its point-in-time form (`result.series` absent); a trend series is
 *  already its own chart (`TrendCard`), not a comparison candidate. */
const SCALAR_TOOLS = new Set<QueryToolName>(['total_spent', 'total_income', 'net_worth']);

export type ComparisonTool = 'total_spent' | 'total_income' | 'net_worth';

/** Card title per scalar tool — mirrors `StatCard`'s own labels in
 *  `AnswerCard.tsx` ("Total spent"/"Total income"/"Net worth"), so a
 *  comparison chart and the single-result card it's standing in for read
 *  the same for the same tool. */
const TITLE_FOR: Record<ComparisonTool, string> = {
  total_spent: 'Total spent',
  total_income: 'Total income',
  net_worth: 'Net worth',
};

export interface ComparisonSeriesEntry {
  /** Deterministic period label ("2025", "this month", "March 2025") — see
   *  `queryCaption.ts`'s `periodChartLabel`, the single source of truth
   *  this reuses. */
  label: string;
  amountMinor: number;
}

export interface QueryComparison {
  tool: ComparisonTool;
  title: string;
  /** One entry per distinct period, in the model's own call order, zero
   *  amounts preserved (never dropped — see the module header). */
  series: ComparisonSeriesEntry[];
}

/** Read the one scalar amount a comparison-eligible tool's result carries,
 *  or `null` when the result isn't shaped like one (e.g. a `net_worth`
 *  call that came back as a `series` trend rather than a point value —
 *  out of scope here, see the module header). */
function scalarAmount(tool: QueryToolName, result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { amountMinor?: unknown; series?: unknown };
  if (tool === 'net_worth' && r.series !== undefined) return null;
  return typeof r.amountMinor === 'number' ? r.amountMinor : null;
}

/** The period a call actually ran with — `asOf` for `net_worth`, `period`
 *  for every other scalar tool (mirrors `queryTools.ts`'s own
 *  `applyDeterministicPeriodOverride`, which distinguishes the same two
 *  param names). `undefined` when the call carries neither — treated as
 *  its own distinct "no period stated" bucket by `periodKeyOf` below. */
function periodOf(call: ComparisonToolCall): PeriodSpec | undefined {
  const params = call.params as { period?: unknown; asOf?: unknown };
  const raw = call.tool === 'net_worth' ? params.asOf : params.period;
  return raw as PeriodSpec | undefined;
}

/** A stable de-dup key for a call's period — reuses `periodRange.ts`'s own
 *  `periodKey` (the exact equality rule `resolvePeriodFromText` uses to
 *  detect a multi-period comparison) so "two calls, same period" can never
 *  be judged differently here than it is there. An absent period gets its
 *  own sentinel key rather than colliding with any real period. */
function periodKeyOf(spec: PeriodSpec | undefined): string {
  return spec === undefined ? '__no_period__' : periodKey(spec);
}

/**
 * Build a comparison series from a completed BYOK tool loop's `calls` (see
 * the module header), or `null` when they don't form one:
 *  - fewer than 2 calls;
 *  - not every call is the SAME tool;
 *  - that tool isn't one of the scalar comparison tools (`SCALAR_TOOLS`);
 *  - any call's result isn't a genuine scalar amount for that tool (e.g. a
 *    `net_worth` series result mixed in);
 *  - after de-duping identical periods, fewer than 2 distinct periods
 *    remain (nothing to compare).
 *
 * Call order is preserved (the model's own ordering); an identical period
 * repeated later is dropped, keeping the FIRST occurrence.
 */
export function buildQueryComparison(calls: ComparisonToolCall[]): QueryComparison | null {
  if (calls.length < 2) return null;

  const tool = calls[0]!.tool;
  if (!SCALAR_TOOLS.has(tool)) return null;
  if (!calls.every((c) => c.tool === tool)) return null;

  const seenPeriods = new Set<string>();
  const series: ComparisonSeriesEntry[] = [];
  for (const call of calls) {
    const amount = scalarAmount(tool, call.result);
    if (amount === null) return null; // not a genuine scalar result for this tool

    const period = periodOf(call);
    const key = periodKeyOf(period);
    if (seenPeriods.has(key)) continue; // de-dup identical periods, keep the first occurrence
    seenPeriods.add(key);
    series.push({ label: periodChartLabel(period), amountMinor: amount });
  }

  if (series.length < 2) return null; // de-duped down to one (or zero) distinct period

  return { tool: tool as ComparisonTool, title: TITLE_FOR[tool as ComparisonTool], series };
}
