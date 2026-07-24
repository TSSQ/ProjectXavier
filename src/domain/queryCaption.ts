/**
 * Deterministic captions for Ask-Xavier answer cards
 * (docs/design/ask-xavier-queries-spec.md §5.4) — used for FM and the
 * no-engine floor, which get "a deterministic one-line caption template (no
 * model prose at all)"; BYOK's own narration (`queryLoop.ts`'s
 * `QueryLoopResult.narration`) is used instead when it produced one. Pure,
 * framework-free, and money-formatting-free (returns plain counts/labels,
 * not currency strings) so it stays testable without a locale/currency
 * dependency and lets the UI layer format any amount it echoes.
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

/**
 * Build a one-line, model-free caption for a tool call + its result. Only
 * reads `call` (never the numeric result), since every number is already on
 * the card itself — the caption just restates WHAT was asked, not the
 * figure.
 */
export function buildDeterministicQueryCaption(call: QueryToolCall): string {
  switch (call.tool) {
    case 'total_spent': {
      const scope = [call.params.category, call.params.payee, call.params.account]
        .filter(Boolean)
        .join(', ');
      return scope
        ? `Spending on ${scope}, ${periodLabel(call.params.period)}.`
        : `Total spending, ${periodLabel(call.params.period)}.`;
    }
    case 'total_income':
      return call.params.category
        ? `Income from ${call.params.category}, ${periodLabel(call.params.period)}.`
        : `Total income, ${periodLabel(call.params.period)}.`;
    case 'spending_by_category':
      return `Spending by category, ${periodLabel(call.params.period)}.`;
    case 'spending_over_time':
      return `Spending trend, ${periodLabel(call.params.period)}.`;
    case 'top_payees':
      return `Top ${call.params.n} payees, ${periodLabel(call.params.period)}.`;
    case 'net_worth':
      return call.params.series ? 'Net worth trend.' : 'Net worth right now.';
    case 'search_transactions':
      return `Transactions, ${periodLabel(call.params.period)}.`;
    default:
      return '';
  }
}
