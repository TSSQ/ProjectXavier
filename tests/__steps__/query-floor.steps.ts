/**
 * BDD suite for src/domain/queryFloor.ts (docs/design/ask-xavier-queries-
 * spec.md §5.3 point 3/§7 acceptance #6) — the no-engine canned patterns.
 */
import { resolveFloorQueryCall } from '../../src/domain/queryFloor';

describe('resolveFloorQueryCall', () => {
  it('"how much did I spend this month" -> total_spent, this_month', () => {
    const call = resolveFloorQueryCall('how much did I spend this month');
    expect(call).toEqual({ tool: 'total_spent', params: { period: 'this_month', category: undefined } });
  });

  it('"how much did I spend last month on dining" -> total_spent, last_month, category dining', () => {
    const call = resolveFloorQueryCall('how much did I spend last month on dining');
    expect(call).toEqual({ tool: 'total_spent', params: { period: 'last_month', category: 'dining' } });
  });

  it('"how much income this year" -> total_income, this_year', () => {
    const call = resolveFloorQueryCall('how much income this year');
    expect(call).toEqual({ tool: 'total_income', params: { period: 'this_year' } });
  });

  it('"what is my net worth" -> net_worth, point value', () => {
    const call = resolveFloorQueryCall('what is my net worth');
    expect(call).toEqual({ tool: 'net_worth', params: { series: false } });
  });

  it('"net worth trend" -> net_worth, series', () => {
    const call = resolveFloorQueryCall('net worth trend');
    expect(call).toEqual({ tool: 'net_worth', params: { series: true } });
  });

  it('"breakdown of my spending" -> spending_by_category', () => {
    const call = resolveFloorQueryCall('breakdown of my spending this month');
    expect(call).toEqual({ tool: 'spending_by_category', params: { period: 'this_month' } });
  });

  it('an unmatched shape returns null — the caller must answer honestly, never guess', () => {
    expect(resolveFloorQueryCall('what is the meaning of life')).toBeNull();
    expect(resolveFloorQueryCall('')).toBeNull();
  });
});
