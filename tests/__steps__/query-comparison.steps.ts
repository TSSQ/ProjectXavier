/**
 * BDD suite for src/domain/queryComparison.ts (docs/design/ask-xavier-
 * queries-spec.md §5.4, device bug build 58) — the deterministic detector
 * that turns a completed BYOK tool loop's `calls` into a comparison chart
 * series instead of the single-last-call card. Every case here builds a
 * plain `ComparisonToolCall[]` (the same shape `QueryLoopResult.calls`
 * carries) and asserts either the exact series produced, or `null` when the
 * calls don't form a genuine same-tool/different-period/scalar-amount
 * comparison.
 */
import { buildQueryComparison, ComparisonToolCall } from '../../src/domain/queryComparison';

function totalSpentCall(period: unknown, amountMinor: number): ComparisonToolCall {
  return {
    tool: 'total_spent',
    params: { period },
    result: { amountMinor, count: amountMinor > 0 ? 1 : 0, notes: [] },
  };
}

function totalIncomeCall(period: unknown, amountMinor: number): ComparisonToolCall {
  return {
    tool: 'total_income',
    params: { period },
    result: { amountMinor, count: 1, notes: [] },
  };
}

function spendingByCategoryCall(period: unknown): ComparisonToolCall {
  return {
    tool: 'spending_by_category',
    params: { period },
    result: { slices: [], notes: [] },
  };
}

describe('buildQueryComparison', () => {
  it('two total_spent calls with different explicit years -> a comparison, zero preserved', () => {
    const calls = [
      totalSpentCall({ kind: 'year', year: 2025 }, 0),
      totalSpentCall({ kind: 'year', year: 2026 }, 15000),
    ];
    expect(buildQueryComparison(calls)).toEqual({
      tool: 'total_spent',
      title: 'Total spent',
      series: [
        { label: '2025', amountMinor: 0 },
        { label: '2026', amountMinor: 15000 },
      ],
    });
  });

  it('two total_income calls with this_month/last_month -> correct token labels', () => {
    const calls = [
      totalIncomeCall('this_month', 500_00),
      totalIncomeCall('last_month', 400_00),
    ];
    expect(buildQueryComparison(calls)).toEqual({
      tool: 'total_income',
      title: 'Total income',
      series: [
        { label: 'this month', amountMinor: 50000 },
        { label: 'last month', amountMinor: 40000 },
      ],
    });
  });

  it('different tools (total_spent + spending_by_category) -> null', () => {
    const calls = [
      totalSpentCall('this_month', 100),
      spendingByCategoryCall('last_month'),
    ];
    expect(buildQueryComparison(calls)).toBeNull();
  });

  it('a single call -> null', () => {
    expect(buildQueryComparison([totalSpentCall('this_month', 100)])).toBeNull();
  });

  it('two calls with the SAME period -> de-duped -> null (nothing to compare)', () => {
    const calls = [totalSpentCall('this_month', 100), totalSpentCall('this_month', 200)];
    expect(buildQueryComparison(calls)).toBeNull();
  });

  it('a non-scalar tool pair (two spending_by_category calls) -> null (out of scope for v1)', () => {
    const calls = [spendingByCategoryCall('this_month'), spendingByCategoryCall('last_month')];
    expect(buildQueryComparison(calls)).toBeNull();
  });

  it('preserves call order across 3+ periods, and de-dups only an EXACT repeat', () => {
    const calls = [
      totalSpentCall({ kind: 'year', year: 2024 }, 100),
      totalSpentCall({ kind: 'year', year: 2025 }, 200),
      totalSpentCall({ kind: 'year', year: 2024 }, 999), // exact repeat of the first period — dropped
      totalSpentCall({ kind: 'year', year: 2026 }, 300),
    ];
    expect(buildQueryComparison(calls)).toEqual({
      tool: 'total_spent',
      title: 'Total spent',
      series: [
        { label: '2024', amountMinor: 100 },
        { label: '2025', amountMinor: 200 },
        { label: '2026', amountMinor: 300 },
      ],
    });
  });

  it('a net_worth series (trend) result mixed into a would-be comparison -> null (not a scalar)', () => {
    const calls: ComparisonToolCall[] = [
      { tool: 'net_worth', params: { asOf: 'this_year' }, result: { amountMinor: 100, notes: [] } },
      { tool: 'net_worth', params: { asOf: 'last_year' }, result: { series: [], notes: [] } },
    ];
    expect(buildQueryComparison(calls)).toBeNull();
  });

  it('two net_worth point-value calls with different asOf periods -> a comparison', () => {
    const calls: ComparisonToolCall[] = [
      { tool: 'net_worth', params: { asOf: 'this_year' }, result: { amountMinor: -500, notes: [] } },
      { tool: 'net_worth', params: { asOf: 'last_year' }, result: { amountMinor: 1000, notes: [] } },
    ];
    expect(buildQueryComparison(calls)).toEqual({
      tool: 'net_worth',
      title: 'Net worth',
      series: [
        { label: 'this year', amountMinor: -500 },
        { label: 'last year', amountMinor: 1000 },
      ],
    });
  });
});
