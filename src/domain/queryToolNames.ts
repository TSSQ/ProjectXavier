/**
 * Leaf constants for the query tools: no imports, so modules that only need the
 * names (the chat log's payload schemas) don't pull in the `ai` package via
 * queryTools.ts. Re-exported from there.
 */
export const QUERY_TOOL_NAMES = [
  'total_spent',
  'total_income',
  'spending_by_category',
  'spending_over_time',
  'top_payees',
  'net_worth',
  'search_transactions',
] as const;

/** The most points a series-producing tool can return (a bucket-loop guard). */
export const MAX_SERIES_BUCKETS = 750;
