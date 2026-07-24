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
 */
import { QueryToolCall } from './queryTools';

const PERIOD_LABEL: Record<string, string> = {
  this_month: 'this month',
  last_month: 'last month',
  this_week: 'this week',
  last_week: 'last week',
  this_year: 'this year',
  last_year: 'last year',
  all_time: 'all time',
};

function periodLabel(token: string | undefined): string {
  return token ? (PERIOD_LABEL[token] ?? token) : 'this month';
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
