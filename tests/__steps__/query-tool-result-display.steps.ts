/**
 * BDD suite for src/domain/queryToolResultDisplay.ts — the model-facing
 * amount-formatting transform (QA device bug, build 56: the BYOK loop used
 * to hand the model raw minor-unit integers, which it then narrated
 * verbatim as if they were the display amount).
 */
import { formatAmountsForModel } from '../../src/domain/queryToolResultDisplay';

describe('formatAmountsForModel', () => {
  it('formats a top-level amountMinor as a display string for a 2-decimal currency', () => {
    const out = formatAmountsForModel({ amountMinor: 5000, count: 2, notes: [] }, 'SGD') as Record<
      string,
      unknown
    >;
    expect(out.amount).toMatch(/^SGD\s50\.00$/);
    expect(out.amountMinor).toBeUndefined();
    expect(out.count).toBe(2); // non-money fields pass through unchanged
    expect(out.notes).toEqual([]);
  });

  it('does NOT divide by 100 for a 0-decimal currency (JPY)', () => {
    const out = formatAmountsForModel({ amountMinor: 5000, count: 1, notes: [] }, 'JPY') as Record<
      string,
      unknown
    >;
    expect(out.amount).toBe('¥5,000');
  });

  it('does NOT divide by 100 for a 0-decimal currency (KRW)', () => {
    const out = formatAmountsForModel({ amountMinor: 123456, notes: [] }, 'KRW') as Record<
      string,
      unknown
    >;
    expect(out.amount).toContain('123,456');
  });

  it('scales a 3-decimal currency (BHD) by 1000, not 100', () => {
    const out = formatAmountsForModel({ amountMinor: 1234, notes: [] }, 'BHD') as Record<
      string,
      unknown
    >;
    expect(out.amount).toMatch(/1\.234/);
  });

  it('formats amountMinor nested inside a "slices" array (spending_by_category)', () => {
    const out = formatAmountsForModel(
      { slices: [{ categoryId: 'c1', name: 'Dining', amountMinor: 2000 }], notes: [] },
      'USD'
    ) as { slices: Array<Record<string, unknown>> };
    expect(out.slices[0]!.amount).toMatch(/^\$?20\.00$|^USD\s20\.00$/);
    expect(out.slices[0]!.amountMinor).toBeUndefined();
    expect(out.slices[0]!.name).toBe('Dining');
  });

  it('formats amountMinor nested inside a "series" array (spending_over_time / net_worth)', () => {
    const out = formatAmountsForModel(
      { series: [{ label: 'July 2026', amountMinor: 10000 }], notes: [] },
      'USD'
    ) as { series: Array<Record<string, unknown>> };
    expect(out.series[0]!.amountMinor).toBeUndefined();
    expect(typeof out.series[0]!.amount).toBe('string');
    expect(out.series[0]!.label).toBe('July 2026');
  });

  it('formats amountMinor nested inside a "rows" array (top_payees / search_transactions)', () => {
    const out = formatAmountsForModel(
      { rows: [{ payeeId: 'p1', name: 'Joe', amountMinor: 500, count: 3 }], notes: [] },
      'USD'
    ) as { rows: Array<Record<string, unknown>> };
    expect(out.rows[0]!.amountMinor).toBeUndefined();
    expect(typeof out.rows[0]!.amount).toBe('string');
    expect(out.rows[0]!.count).toBe(3);
  });

  it('is pure — never mutates the input', () => {
    const input = { amountMinor: 500, notes: [] };
    const clone = JSON.parse(JSON.stringify(input));
    formatAmountsForModel(input, 'USD');
    expect(input).toEqual(clone);
  });

  it('passes through non-object/array values (e.g. an {error} payload) unchanged', () => {
    expect(formatAmountsForModel({ error: 'invalid parameters for this tool' }, 'USD')).toEqual({
      error: 'invalid parameters for this tool',
    });
    expect(formatAmountsForModel(null, 'USD')).toBeNull();
  });

  it('never throws on a malformed currency code — falls back to a plain fixed-point string', () => {
    expect(() => formatAmountsForModel({ amountMinor: 500 }, 'NOT_A_CODE')).not.toThrow();
    const out = formatAmountsForModel({ amountMinor: 500 }, 'NOT_A_CODE') as Record<string, unknown>;
    expect(typeof out.amount).toBe('string');
  });
});
