/**
 * Deterministic captions for Ask-Xavier answer cards
 * (docs/design/ask-xavier-queries-spec.md §5.4) — used for FM and the
 * no-engine floor, which get "a deterministic one-line caption template (no
 * model prose at all)"; BYOK's own narration (`queryLoop.ts`'s
 * `QueryLoopResult.narration`) is used instead when it produced one. Pure,
 * framework-free, and money-formatting-free (returns plain counts/labels,
 * not currency strings) so it stays testable without a locale/currency
 * dependency and lets the UI layer format any amount it echoes.
 *
 * ── QA BUG 2 fix (device testing, build 55) ────────────────────────────────
 * This used to build its "Spending on X, Y, Z" scope straight from
 * `call.params.category/payee/account` — the model's REQUESTED filter
 * strings. That produced two flavors of lie: a sentinel value the model
 * emitted for "not specified" ("none"/"any"/etc. — see
 * `queryTools.ts`'s `isNoFilter`) rendered as "Spending on none, none,
 * none", and a hallucinated-but-unresolvable name (the tool ran UNFILTERED,
 * per the "never silent-zero" rule) still showed up in the caption as if it
 * had actually filtered — "Spending on shopping, Amazon, checking" even
 * though the number on the card was the TOTAL, unfiltered figure.
 *
 * The caption must describe what the tool call ACTUALLY DID, not what was
 * merely asked for. So every caption builder below reads the tool's
 * `result` (specifically its `resolvedCategory`/`resolvedPayee`/
 * `resolvedAccount` — see `queryTools.ts`'s `ResolvedFilterNames`, populated
 * ONLY when a filter genuinely matched a real entity) instead of
 * `call.params`. A sentinel or unresolved filter leaves the corresponding
 * `resolved*` field undefined, so the scope is empty and the caption falls
 * back to "Total spending, this month" — honest either way.
 *
 * ── QA device bug (build 57) ────────────────────────────────────────────
 * "how much income for year 2026" used to caption "Total income, THIS
 * MONTH" — the model's `period` token was taken as-is, with no way to even
 * EXPRESS "2026" (`PERIOD_TOKENS` has no explicit-year member). Now that
 * `src/domain/periodRange.ts`'s `resolvePeriodFromText` can deterministically
 * override the executed period with an explicit `{ kind: 'year', year }` or
 * `{ kind: 'month', year, month }` (see that file's header), `periodLabel`
 * below renders them as "in 2026" / "in March 2025" — never silently
 * relabeling a different-period answer as "this month".
 */
import { QueryToolCall } from './queryTools';
import { PeriodSpec } from './periodRange';

const PERIOD_LABEL: Record<string, string> = {
  this_month: 'this month',
  last_month: 'last month',
  this_week: 'this week',
  last_week: 'last week',
  this_year: 'this year',
  last_year: 'last year',
  all_time: 'all time',
};

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Bare period label with NO leading preposition — "2025", "March 2025",
 * "this month" — the single source of truth for "what is this period
 * actually called". Exported so `src/domain/queryComparison.ts` can build
 * compact chart-bar labels ("2025"/"2026") from the SAME token/month-name
 * tables this module's own sentence-style `periodLabel` (below) uses,
 * without duplicating them — a sentence-style "in 2025" reads fine glued
 * into a caption but is the wrong shape for an axis label.
 */
export function periodChartLabel(spec: PeriodSpec | undefined): string {
  if (!spec) return 'this month';
  if (typeof spec === 'object') {
    return spec.kind === 'month' ? `${MONTH_LABELS[spec.month]} ${spec.year}` : `${spec.year}`;
  }
  return PERIOD_LABEL[spec] ?? spec;
}

/** Sentence-style period label — "in 2025", "in March 2025", "this month" —
 *  glued directly after a comma inside a caption sentence (see every case
 *  below). Wraps `periodChartLabel` with the "in " preposition only for the
 *  object-shaped (explicit year/month) specs, where the bare form alone
 *  wouldn't read as a sentence fragment. */
function periodLabel(spec: PeriodSpec | undefined): string {
  const bare = periodChartLabel(spec);
  return typeof spec === 'object' ? `in ${bare}` : bare;
}

/** The subset of every tool result's shape this module reads — just the
 *  resolved-filter-name fields every relevant result type carries (see
 *  `queryTools.ts`'s `ResolvedFilterNames`). Declared locally (rather than
 *  importing the result types) so this stays a minimal, additive read on an
 *  otherwise-`unknown` result. */
interface ResolvedFilterNamesLike {
  resolvedCategory?: string;
  resolvedPayee?: string;
  resolvedAccount?: string;
}

function asResolved(result: unknown): ResolvedFilterNamesLike {
  return (result ?? {}) as ResolvedFilterNamesLike;
}

/**
 * Build a one-line, model-free caption for a tool call + its result. The
 * PERIOD (and, for `top_payees`/`net_worth`, `n`/`series`) still come from
 * `call.params` — those are never re-resolved, so there's nothing dishonest
 * about echoing them. Any category/payee/account SCOPE mentioned, though,
 * comes ONLY from `result`'s resolved-filter-name fields (see the module
 * header's QA BUG 2 note) — never from `call.params`, which may hold a
 * sentinel ("none") or an unresolvable, hallucinated name the tool ran
 * UNFILTERED despite.
 */
export function buildDeterministicQueryCaption(call: QueryToolCall, result: unknown): string {
  const resolved = asResolved(result);
  switch (call.tool) {
    case 'total_spent': {
      const scope = [resolved.resolvedCategory, resolved.resolvedPayee, resolved.resolvedAccount]
        .filter(Boolean)
        .join(', ');
      return scope
        ? `Spending on ${scope}, ${periodLabel(call.params.period)}.`
        : `Total spending, ${periodLabel(call.params.period)}.`;
    }
    case 'total_income':
      return resolved.resolvedCategory
        ? `Income from ${resolved.resolvedCategory}, ${periodLabel(call.params.period)}.`
        : `Total income, ${periodLabel(call.params.period)}.`;
    case 'spending_by_category':
      return `Spending by category, ${periodLabel(call.params.period)}.`;
    case 'spending_over_time':
      return resolved.resolvedCategory
        ? `Spending trend for ${resolved.resolvedCategory}, ${periodLabel(call.params.period)}.`
        : `Spending trend, ${periodLabel(call.params.period)}.`;
    case 'top_payees':
      return `Top ${call.params.n} payees, ${periodLabel(call.params.period)}.`;
    case 'net_worth':
      return call.params.series ? 'Net worth trend.' : 'Net worth right now.';
    case 'search_transactions': {
      const scope = [resolved.resolvedCategory, resolved.resolvedPayee, resolved.resolvedAccount]
        .filter(Boolean)
        .join(', ');
      return scope
        ? `Transactions for ${scope}, ${periodLabel(call.params.period)}.`
        : `Transactions, ${periodLabel(call.params.period)}.`;
    }
    default:
      return '';
  }
}
