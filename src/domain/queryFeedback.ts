/**
 * "Wrong answer" on an Ask-Xavier card — the pure half of the answer
 * feedback loop. Framework-free (BDD: tests/__features__/query-feedback.feature).
 *
 * The user says what the question should have been: another of the seven
 * tools, another period (or "other" — none of the listed ones), another
 * category / payee from their own lists (or none). `correctedCall` turns that
 * into a tool call the existing `executeQueryTool` path re-runs (no model
 * call); `wrongDimensions` names what changed (the metric and the correction
 * case record it); `answerFigure` reads the before/after number off a result.
 */
import { PERIOD_TOKENS, PeriodSpec, PeriodToken } from './periodRange';
import { QueryToolCall, QueryToolName, QUERY_TOOL_NAMES } from './queryTools';
import { FilterDimension, FilterResolution } from './queryFilterResolution';

/** The tools, labelled plainly, in the order the panel lists them. */
export const QUERY_TOOL_LABELS: Record<QueryToolName, string> = {
  total_spent: 'Total spent',
  total_income: 'Total income',
  spending_by_category: 'Spending by category',
  spending_over_time: 'Spending over time',
  top_payees: 'Top payees',
  net_worth: 'Net worth',
  search_transactions: 'Find transactions',
};

export const FEEDBACK_TOOLS: readonly QueryToolName[] = QUERY_TOOL_NAMES;

/** "other": the right period is none of the listed ones. */
export type FeedbackPeriod = PeriodToken | 'other';
export const FEEDBACK_PERIODS: readonly FeedbackPeriod[] = [...PERIOD_TOKENS, 'other'];

export const FEEDBACK_PERIOD_LABELS: Record<FeedbackPeriod, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_week: 'This week',
  last_week: 'Last week',
  this_year: 'This year',
  last_year: 'Last year',
  all_time: 'All time',
  other: 'Other',
};

/** The category / payee the answer should have been about (`id: null` =
 *  no filter at all). */
export interface FeedbackFilter {
  dim: Extract<FilterDimension, 'category' | 'payee'>;
  id: string | null;
  name: string | null;
}

/** What the user picked. An absent field means "that part was right". */
export interface QueryFeedbackChoice {
  tool?: QueryToolName;
  period?: FeedbackPeriod;
  filter?: FeedbackFilter;
}

export type WrongDimension = 'tool' | 'period' | 'filter';
export const WRONG_DIMENSIONS: readonly WrongDimension[] = ['tool', 'period', 'filter'];

/** Which tools take which filter. */
export function toolFilters(tool: QueryToolName): Array<'category' | 'payee'> {
  switch (tool) {
    case 'total_spent':
    case 'total_income':
    case 'search_transactions':
      return ['category', 'payee'];
    case 'spending_over_time':
      return ['category'];
    default:
      return [];
  }
}

/** The category kind a tool's filter is scoped to (search: either). */
export function toolCategoryKind(tool: QueryToolName): 'expense' | 'income' | 'any' {
  if (tool === 'total_income') return 'income';
  if (tool === 'search_transactions') return 'any';
  return 'expense';
}

/** The period a call ran for. Net worth: its `asOf`; a trend without one
 *  runs over last year (`netWorthTool`); a point without one is "right now"
 *  (this month). */
export function callPeriod(call: QueryToolCall): PeriodSpec {
  if (call.tool === 'net_worth') return call.params.asOf ?? (call.params.series ? 'last_year' : 'this_month');
  return call.params.period;
}

/** The token a period reads as on the panel; null for an explicit year/month
 *  (`resolvePeriodFromText`'s override), which no chip names. */
export function periodToken(spec: PeriodSpec): PeriodToken | null {
  return typeof spec === 'string' ? spec : null;
}

/** The call's category / payee words, as asked. */
export function callTerms(call: QueryToolCall): Partial<Record<'category' | 'payee', string>> {
  const p = call.params as { category?: string; payee?: string };
  return {
    ...(p.category ? { category: p.category } : {}),
    ...(p.payee ? { payee: p.payee } : {}),
  };
}

/**
 * The corrected call, plus the entity to pin (by id, see `pinnedFilter`).
 * The period "other" keeps the period that ran (nothing lists the right one);
 * an explicit-year override is kept unless a chip replaced it. A filter
 * replaces every category / payee filter; one the new tool cannot take is
 * dropped. The account filter, granularity, `n` and `limit` carry over where
 * the tool has them.
 */
export function correctedCall(
  original: QueryToolCall,
  choice: QueryFeedbackChoice
): { call: QueryToolCall; pinned?: { dim: 'category' | 'payee'; id: string } } {
  const tool = choice.tool ?? original.tool;
  const period: PeriodSpec =
    choice.period && choice.period !== 'other' ? choice.period : callPeriod(original);
  const prev = original.params as Record<string, unknown>;
  const allowed = toolFilters(tool);

  const terms: Partial<Record<'category' | 'payee', string>> = choice.filter ? {} : callTerms(original);
  let pinned: { dim: 'category' | 'payee'; id: string } | undefined;
  if (choice.filter?.id && choice.filter.name && allowed.includes(choice.filter.dim)) {
    // The user's own word stays the param when there was one (the pin
    // decides the entity); otherwise the entity's name.
    terms[choice.filter.dim] = callTerms(original)[choice.filter.dim] ?? choice.filter.name;
    pinned = { dim: choice.filter.dim, id: choice.filter.id };
  }
  const filters: Record<string, string> = {};
  for (const dim of allowed) if (terms[dim]) filters[dim] = terms[dim]!;
  const account = typeof prev.account === 'string' && (tool === 'total_spent' || tool === 'search_transactions')
    ? { account: prev.account }
    : {};

  let call: QueryToolCall;
  switch (tool) {
    case 'total_spent':
      call = { tool, params: { period, ...filters, ...account } };
      break;
    case 'total_income':
      call = { tool, params: { period, ...filters } };
      break;
    case 'spending_by_category':
      call = { tool, params: { period } };
      break;
    case 'spending_over_time': {
      const granularity =
        original.tool === 'spending_over_time'
          ? original.params.granularity
          : period === 'this_week' || period === 'last_week' || period === 'this_month' || period === 'last_month'
            ? 'day'
            : 'month';
      call = { tool, params: { period, granularity, ...filters } };
      break;
    }
    case 'top_payees':
      call = { tool, params: { period, n: original.tool === 'top_payees' ? original.params.n : 5 } };
      break;
    case 'net_worth':
      call = {
        tool,
        params: {
          // A chip-picked period, else what ran: the original net worth's own
          // params, or another tool's period (as of its end).
          ...(choice.period && choice.period !== 'other'
            ? { asOf: period }
            : original.tool === 'net_worth'
              ? original.params.asOf
                ? { asOf: original.params.asOf }
                : {}
              : { asOf: period }),
          ...(original.tool === 'net_worth' && original.params.series ? { series: true } : {}),
        },
      };
      break;
    case 'search_transactions':
      call = {
        tool,
        params: {
          period,
          ...filters,
          ...account,
          limit: original.tool === 'search_transactions' ? original.params.limit : 10,
        },
      };
      break;
  }
  return pinned ? { call, pinned } : { call };
}

/** The one entity each category / payee filter applied — its first id
 *  (sub-categories follow it); none for a union or an unresolved word. */
export function appliedEntities(filters: readonly FilterResolution[]): Partial<Record<'category' | 'payee', string>> {
  const out: Partial<Record<'category' | 'payee', string>> = {};
  for (const f of filters) {
    if ((f.dim === 'category' || f.dim === 'payee') && f.names.length === 1 && f.ids[0]) out[f.dim] = f.ids[0];
  }
  return out;
}

/** What the user's choice changed, in `WRONG_DIMENSIONS` order. A choice
 *  equal to what already ran (`applied`, see `appliedEntities`) is not a
 *  change. */
export function wrongDimensions(
  original: QueryToolCall,
  choice: QueryFeedbackChoice,
  applied: Partial<Record<'category' | 'payee', string>> = {}
): WrongDimension[] {
  const out: WrongDimension[] = [];
  if (choice.tool && choice.tool !== original.tool) out.push('tool');
  if (choice.period) {
    const ran = callPeriod(original);
    if (choice.period === 'other' || choice.period !== ran) out.push('period');
  }
  if (choice.filter) {
    const terms = callTerms(original);
    const same = choice.filter.id
      ? applied[choice.filter.dim] === choice.filter.id &&
        Object.keys(terms).every((d) => d === choice.filter!.dim)
      : Object.keys(terms).length === 0;
    if (!same) out.push('filter');
  }
  return out;
}

/** The comma list stored in the parse_metrics `wrong_dims` column ('' for
 *  "marked wrong, nothing changed"). Content-free: dimension names only. */
export function wrongDimsValue(dims: readonly WrongDimension[]): string {
  return WRONG_DIMENSIONS.filter((d) => dims.includes(d)).join(',');
}

/** A second mark on the same question adds its dimensions to the first. */
export function mergeWrongDims(previous: string | null | undefined, dims: readonly WrongDimension[]): string {
  return wrongDimsValue([...parseWrongDims(previous), ...dims]);
}

/** Parse the column back; unknown names are dropped. */
export function parseWrongDims(value: string | null | undefined): WrongDimension[] {
  if (!value) return [];
  return value.split(',').filter((d): d is WrongDimension => (WRONG_DIMENSIONS as readonly string[]).includes(d));
}

/** The headline number of an answer, and how many items it listed. */
export interface AnswerFigure {
  amountMinor: number | null;
  items: number | null;
}

/** Read the headline figure off a tool's own result: the total for a
 *  scalar, the sum of the chart / list, the last point of a net-worth trend;
 *  search lists rows of mixed types, so only its row count. */
export function answerFigure(tool: QueryToolName, result: unknown): AnswerFigure {
  const r = (result ?? {}) as {
    amountMinor?: number;
    series?: Array<{ amountMinor: number }>;
    slices?: Array<{ amountMinor: number }>;
    rows?: Array<{ amountMinor: number }>;
  };
  const sum = (xs: Array<{ amountMinor: number }> | undefined) => (xs ? xs.reduce((s, x) => s + x.amountMinor, 0) : null);
  switch (tool) {
    case 'total_spent':
    case 'total_income':
      return { amountMinor: r.amountMinor ?? null, items: null };
    case 'net_worth':
      return {
        amountMinor: r.series ? (r.series[r.series.length - 1]?.amountMinor ?? null) : (r.amountMinor ?? null),
        items: r.series ? r.series.length : null,
      };
    case 'spending_over_time':
      return { amountMinor: sum(r.series), items: r.series?.length ?? null };
    case 'spending_by_category':
      return { amountMinor: sum(r.slices), items: r.slices?.length ?? null };
    case 'top_payees':
      return { amountMinor: sum(r.rows), items: r.rows?.length ?? null };
    case 'search_transactions':
      return { amountMinor: null, items: r.rows?.length ?? null };
  }
}
