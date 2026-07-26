/**
 * BDD suite for src/domain/queryToolSelection.ts (docs/design/ask-xavier-
 * queries-spec.md §5.3/§7 acceptance #4) — the FM single-shot tool-selection
 * contract's normalize step. Zod-validated; a hallucinated tool name/params
 * is rejected -> null; the raw schema carries no amount/date fields.
 */
import {
  queryToolSelectionSchema,
  normalizeQueryToolSelection,
  buildQueryToolSelectionInstructions,
} from '../../src/domain/queryToolSelection';

describe('queryToolSelectionSchema', () => {
  it('has no amount or free-form date field anywhere in its shape', () => {
    const keys = Object.keys(queryToolSelectionSchema.shape);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/amount|date|price|balance/);
    }
    // period is a closed token enum, not a free string/number.
    expect(keys).toContain('period');
  });
});

describe('normalizeQueryToolSelection', () => {
  it('normalizes a well-formed total_spent selection', () => {
    const call = normalizeQueryToolSelection({
      tool: 'total_spent',
      period: 'this_month',
      category: 'Dining',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'unspecified',
    });
    expect(call).toEqual({
      tool: 'total_spent',
      params: { period: 'this_month', category: 'Dining', payee: undefined, account: undefined },
    });
  });

  it('a hallucinated tool name is REJECTED -> null (falls through)', () => {
    const call = normalizeQueryToolSelection({
      tool: 'delete_everything',
      period: 'this_month',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'unspecified',
    });
    expect(call).toBeNull();
  });

  it('"none" is a valid model pick and also normalizes to null', () => {
    const call = normalizeQueryToolSelection({
      tool: 'none',
      period: 'unspecified',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'unspecified',
    });
    expect(call).toBeNull();
  });

  it('a garbage/non-object raw payload never throws and normalizes to null', () => {
    expect(() => normalizeQueryToolSelection({} as Record<string, unknown>)).not.toThrow();
    expect(normalizeQueryToolSelection({} as Record<string, unknown>)).toBeNull();
  });

  it('defaults an unspecified period to this_month for ordinary tools', () => {
    const call = normalizeQueryToolSelection({
      tool: 'spending_by_category',
      period: 'unspecified',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'unspecified',
    });
    expect(call).toEqual({ tool: 'spending_by_category', params: { period: 'this_month' } });
  });

  it('net_worth leaves period unspecified as "asOf: undefined" (current net worth), not defaulted', () => {
    const call = normalizeQueryToolSelection({
      tool: 'net_worth',
      period: 'unspecified',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'false',
    });
    expect(call).toEqual({ tool: 'net_worth', params: { asOf: undefined, series: false } });
  });

  it('net_worth honors series="true"', () => {
    const call = normalizeQueryToolSelection({
      tool: 'net_worth',
      period: 'unspecified',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'true',
    });
    expect((call?.params as { series?: boolean })?.series).toBe(true);
  });

  it('clamps topN into 1-10 for top_payees, defaulting 0 to 5', () => {
    const call = normalizeQueryToolSelection({
      tool: 'top_payees',
      period: 'this_year',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 0,
      series: 'unspecified',
    });
    expect(call).toEqual({ tool: 'top_payees', params: { period: 'this_year', n: 5 } });

    const overshoot = normalizeQueryToolSelection({
      tool: 'top_payees',
      period: 'this_year',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 99,
      series: 'unspecified',
    });
    expect((overshoot?.params as { n: number }).n).toBe(10);
  });

  it('defaults an unrecognised granularity to "day" for spending_over_time', () => {
    const call = normalizeQueryToolSelection({
      tool: 'spending_over_time',
      period: 'this_month',
      category: '',
      payee: '',
      account: '',
      granularity: 'fortnight',
      topN: 0,
      series: 'unspecified',
    });
    expect((call?.params as { granularity: string }).granularity).toBe('day');
  });

  it('search_transactions ignores model input for limit, always using a safe default', () => {
    const call = normalizeQueryToolSelection({
      tool: 'search_transactions',
      period: 'this_month',
      category: '',
      payee: '',
      account: '',
      granularity: 'unspecified',
      topN: 999,
      series: 'unspecified',
    });
    expect((call?.params as { limit: number }).limit).toBe(10);
  });
});

// QA BUG 4 (device testing, build 55): the FM instructions must steer the
// model toward spending_by_category (the donut) rather than total_spent (a
// single stat) for a general "where did my money go"/"breakdown"/"what did
// I spend on" question — a prompt-text assertion, mirroring the existing
// "instructions contain snippet" convention (device-parse-prompt.steps.ts).
describe('buildQueryToolSelectionInstructions (QA BUG 4)', () => {
  it('steers toward spending_by_category for "where did my money go" / breakdown / "what did I spend on" phrasing', () => {
    const instructions = buildQueryToolSelectionInstructions();
    expect(instructions).toContain('spending_by_category');
    expect(instructions).toContain('where did/does my money/it go/went');
    expect(instructions).toContain('breakdown');
    expect(instructions).toContain('what did I spend on');
  });
});
