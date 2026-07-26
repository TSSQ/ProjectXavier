/**
 * BDD suite for src/domain/queryCaption.ts — the deterministic, model-free
 * caption template used for FM/floor answer cards (docs/design/ask-xavier-
 * queries-spec.md §5.4).
 *
 * QA BUG 2 (device testing, build 55): the caption must describe what the
 * tool call ACTUALLY DID (the RESOLVED filters, from the result), never what
 * was merely requested (`call.params`, which may be a sentinel like "none"
 * or an unresolved/hallucinated name the tool ran unfiltered despite).
 */
import { buildDeterministicQueryCaption } from '../../src/domain/queryCaption';

describe('buildDeterministicQueryCaption', () => {
  it('total_spent with no filters', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: 'this_month' } },
      { amountMinor: 100, count: 1, notes: [] }
    );
    expect(caption).toBe('Total spending, this month.');
  });

  it('total_spent with a filter that actually RESOLVED', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: 'last_month', category: 'Dining' } },
      { amountMinor: 100, count: 1, notes: [], resolvedCategory: 'Dining' }
    );
    expect(caption).toBe('Spending on Dining, last month.');
  });

  it('QA BUG 2: a sentinel filter value ("none") never appears in the caption', () => {
    const caption = buildDeterministicQueryCaption(
      {
        tool: 'total_spent',
        params: { period: 'this_month', category: 'none', payee: 'any', account: 'n/a' },
      },
      // The tool never resolved any of these (isNoFilter short-circuited
      // them before ever calling findCategoryMatch/etc.) — so the result
      // carries no resolved* fields at all.
      { amountMinor: 500, count: 3, notes: [] }
    );
    expect(caption).toBe('Total spending, this month.');
    expect(caption).not.toMatch(/none/i);
  });

  it('QA BUG 2: an unresolved (hallucinated) filter that ran UNFILTERED never appears in the caption', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: 'this_month', category: 'shopping', payee: 'Amazon', account: 'checking' } },
      {
        amountMinor: 500,
        count: 3,
        // The tool ran unfiltered (per "never silent-zero") and flagged it —
        // resolved* stays undefined since nothing actually matched.
        notes: [
          'couldn\'t find category "shopping" — showing all',
          'couldn\'t find payee "Amazon" — showing all',
          'couldn\'t find account "checking" — showing all',
        ],
      }
    );
    expect(caption).toBe('Total spending, this month.');
    expect(caption).not.toMatch(/shopping|amazon|checking/i);
  });

  it('total_income mirrors the same resolved-only rule', () => {
    expect(
      buildDeterministicQueryCaption(
        { tool: 'total_income', params: { period: 'this_year', category: 'none' } },
        { amountMinor: 1, count: 1, notes: [] }
      )
    ).toBe('Total income, this year.');
    expect(
      buildDeterministicQueryCaption(
        { tool: 'total_income', params: { period: 'this_year', category: 'Salary' } },
        { amountMinor: 1, count: 1, notes: [], resolvedCategory: 'Salary' }
      )
    ).toBe('Income from Salary, this year.');
  });

  it('search_transactions mirrors the same resolved-only rule', () => {
    expect(
      buildDeterministicQueryCaption(
        { tool: 'search_transactions', params: { period: 'this_month', category: 'all', limit: 10 } },
        { rows: [], notes: [] }
      )
    ).toBe('Transactions, this month.');
    expect(
      buildDeterministicQueryCaption(
        { tool: 'search_transactions', params: { period: 'this_month', payee: 'Joe', limit: 10 } },
        { rows: [], notes: [], resolvedPayee: "Joe's Diner" }
      )
    ).toBe("Transactions for Joe's Diner, this month.");
  });

  it('net_worth point value vs. series', () => {
    expect(
      buildDeterministicQueryCaption({ tool: 'net_worth', params: {} }, { amountMinor: 100, notes: [] })
    ).toBe('Net worth right now.');
    expect(
      buildDeterministicQueryCaption(
        { tool: 'net_worth', params: { series: true } },
        { series: [], notes: [] }
      )
    ).toBe('Net worth trend.');
  });

  it('never mentions a number — captions restate WHAT was asked, not the figure', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: 'this_year' } },
      { amountMinor: 123456, count: 7, notes: [] }
    );
    expect(caption).not.toMatch(/\d/);
  });

  // QA device bug (build 57): "how much income for year 2026" used to
  // caption "Total income, THIS MONTH" — an explicit-year period must
  // render as "in <year>", never silently mislabeled as "this month".
  it('an explicit-year period renders as "in <year>", never "this month"', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_income', params: { period: { kind: 'year', year: 2026 } } },
      { amountMinor: 1_000_000, count: 4, notes: [] }
    );
    expect(caption).toBe('Total income, in 2026.');
    expect(caption).not.toMatch(/this month/i);
  });

  it('an explicit-year period for a PAST year renders that year, not the current one', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: { kind: 'year', year: 2025 } } },
      { amountMinor: 500, count: 1, notes: [] }
    );
    expect(caption).toBe('Total spending, in 2025.');
  });

  // QA MINOR (device testing, build 57 re-gate): "March 2025" used to
  // silently fall back to the whole year with a misleading "in 2025"
  // caption — an explicit MONTH must render its own month name and year.
  it('an explicit-month period renders as "in <Month> <year>"', () => {
    const caption = buildDeterministicQueryCaption(
      { tool: 'total_spent', params: { period: { kind: 'month', year: 2025, month: 2 } } },
      { amountMinor: 500, count: 1, notes: [] }
    );
    expect(caption).toBe('Total spending, in March 2025.');
    expect(caption).not.toBe('Total spending, in 2025.');
  });
});
