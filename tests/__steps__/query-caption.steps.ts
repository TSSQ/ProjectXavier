/**
 * BDD suite for src/domain/queryCaption.ts — the deterministic, model-free
 * caption template used for FM/floor answer cards (docs/design/ask-xavier-
 * queries-spec.md §5.4).
 */
import { buildDeterministicQueryCaption } from '../../src/domain/queryCaption';

describe('buildDeterministicQueryCaption', () => {
  it('total_spent with no filters', () => {
    const caption = buildDeterministicQueryCaption({
      tool: 'total_spent',
      params: { period: 'this_month' },
    });
    expect(caption).toBe('Total spending, this month.');
  });

  it('total_spent with a category filter', () => {
    const caption = buildDeterministicQueryCaption({
      tool: 'total_spent',
      params: { period: 'last_month', category: 'Dining' },
    });
    expect(caption).toBe('Spending on Dining, last month.');
  });

  it('net_worth point value vs. series', () => {
    expect(buildDeterministicQueryCaption({ tool: 'net_worth', params: {} })).toBe('Net worth right now.');
    expect(
      buildDeterministicQueryCaption({ tool: 'net_worth', params: { series: true } })
    ).toBe('Net worth trend.');
  });

  it('never mentions a number — captions restate WHAT was asked, not the figure', () => {
    const caption = buildDeterministicQueryCaption({
      tool: 'total_spent',
      params: { period: 'this_year' },
    });
    expect(caption).not.toMatch(/\d/);
  });
});
