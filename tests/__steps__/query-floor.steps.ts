/**
 * BDD suite for src/domain/queryFloor.ts (docs/design/ask-xavier-queries-
 * spec.md §5.3 point 3/§7 acceptance #6) — the no-engine canned patterns.
 */
import { FloorEntities, resolveFloorQueryCall } from '../../src/domain/queryFloor';

// Wed 15 July 2026 — matches the fixed `now` used by
// tests/__steps__/period-range.steps.ts, so explicit-year cases below stay
// well within `resolvePeriodFromText`'s `[1990, thisYear + 1]` bound.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

describe('resolveFloorQueryCall', () => {
  it('"how much did I spend this month" -> total_spent, this_month', () => {
    const call = resolveFloorQueryCall('how much did I spend this month', NOW);
    expect(call).toEqual({ tool: 'total_spent', params: { period: 'this_month', category: undefined } });
  });

  it('"how much did I spend last month on dining" -> total_spent, last_month, category dining', () => {
    const call = resolveFloorQueryCall('how much did I spend last month on dining', NOW);
    expect(call).toEqual({ tool: 'total_spent', params: { period: 'last_month', category: 'dining' } });
  });

  it('"how much income this year" -> total_income, this_year', () => {
    const call = resolveFloorQueryCall('how much income this year', NOW);
    expect(call).toEqual({ tool: 'total_income', params: { period: 'this_year' } });
  });

  it('"what is my net worth" -> net_worth, point value', () => {
    const call = resolveFloorQueryCall('what is my net worth', NOW);
    expect(call).toEqual({ tool: 'net_worth', params: { series: false } });
  });

  it('"net worth trend" -> net_worth, series', () => {
    const call = resolveFloorQueryCall('net worth trend', NOW);
    expect(call).toEqual({ tool: 'net_worth', params: { series: true } });
  });

  // QA MAJOR 2 (device testing, build 57 re-gate): net_worth's period was
  // silently dropped on the floor — "what was my net worth in 2020"/"net
  // worth last year" answered with the CURRENT net worth, no note.
  describe('net_worth honors a stated period via "asOf" (QA MAJOR 2)', () => {
    it('"what was my net worth in 2020" -> net_worth, asOf explicit year 2020', () => {
      const call = resolveFloorQueryCall('what was my net worth in 2020', NOW);
      expect(call).toEqual({
        tool: 'net_worth',
        params: { series: false, asOf: { kind: 'year', year: 2020 } },
      });
    });

    it('"net worth last year" -> net_worth, asOf last_year', () => {
      const call = resolveFloorQueryCall('net worth last year', NOW);
      expect(call).toEqual({ tool: 'net_worth', params: { series: false, asOf: 'last_year' } });
    });

    it('"what is my net worth" (no period stated) has NO "asOf" — omitted means "right now"', () => {
      const call = resolveFloorQueryCall('what is my net worth', NOW);
      expect(call).toEqual({ tool: 'net_worth', params: { series: false } });
      expect(call && 'asOf' in call.params).toBe(false);
    });
  });

  it('"breakdown of my spending" -> spending_by_category', () => {
    const call = resolveFloorQueryCall('breakdown of my spending this month', NOW);
    expect(call).toEqual({ tool: 'spending_by_category', params: { period: 'this_month' } });
  });

  it('an unmatched shape returns null — the caller must answer honestly, never guess', () => {
    expect(resolveFloorQueryCall('what is the meaning of life', NOW)).toBeNull();
    expect(resolveFloorQueryCall('', NOW)).toBeNull();
  });

  // QA BUG 4 (device testing, build 55): "where did my money go" and its
  // variants should get the donut (spending_by_category), not a single
  // total_spent stat — sharpened past the original literal-phrase-only match.
  describe('"where did my money go" family and bare "what did I spend on" prefer spending_by_category (QA BUG 4)', () => {
    it('"where did my money go" -> spending_by_category', () => {
      expect(resolveFloorQueryCall('where did my money go', NOW)).toEqual({
        tool: 'spending_by_category',
        params: { period: 'this_month' },
      });
    });

    it('"where does my money go" -> spending_by_category', () => {
      expect(resolveFloorQueryCall('where does my money go', NOW)).toEqual({
        tool: 'spending_by_category',
        params: { period: 'this_month' },
      });
    });

    it("\"where's my money going\" -> spending_by_category", () => {
      expect(resolveFloorQueryCall("where's my money going", NOW)).toEqual({
        tool: 'spending_by_category',
        params: { period: 'this_month' },
      });
    });

    it('"what did I spend on" (bare, no category named) -> spending_by_category', () => {
      expect(resolveFloorQueryCall('what did I spend on', NOW)).toEqual({
        tool: 'spending_by_category',
        params: { period: 'this_month' },
      });
    });

    it('"what did I spend on food" (a category IS named) still -> total_spent with that category', () => {
      expect(resolveFloorQueryCall('what did I spend on food', NOW)).toEqual({
        tool: 'total_spent',
        params: { period: 'this_month', category: 'food' },
      });
    });
  });

  // QA device bug (build 57): the floor used to have its OWN, narrower period
  // detector with no explicit-year support at all — "how much income for
  // year 2026" on the floor would have silently defaulted to `this_month`.
  // `detectPeriod` now defers to the shared `resolvePeriodFromText`.
  describe('the floor resolves an explicit year via the shared extractor (QA device bug, build 57)', () => {
    it('"how much income for year 2026" -> total_income, explicit year 2026', () => {
      const call = resolveFloorQueryCall('how much income for year 2026', NOW);
      expect(call).toEqual({ tool: 'total_income', params: { period: { kind: 'year', year: 2026 } } });
    });

    it('"how much did I spend in 2025" -> total_spent, explicit year 2025 (a PAST year, not this_month)', () => {
      const call = resolveFloorQueryCall('how much did I spend in 2025', NOW);
      expect(call).toEqual({
        tool: 'total_spent',
        params: { period: { kind: 'year', year: 2025 }, category: undefined },
      });
    });

    it('a relative phrase still wins when present (no explicit year to compete with)', () => {
      const call = resolveFloorQueryCall('how much income this year', NOW);
      expect(call).toEqual({ tool: 'total_income', params: { period: 'this_year' } });
    });
  });

  describe("with the user's lists, a loose name is resolved across kinds (floor filter gaps)", () => {
    const LISTS: FloorEntities = {
      categories: [
        { id: 'c-food', name: 'Food', kind: 'expense' },
        { id: 'c-dining', name: 'Dining Out', kind: 'expense' },
        { id: 'c-transport', name: 'Transport', kind: 'expense' },
        { id: 'c-allow', name: 'Allowance', kind: 'income' },
      ],
      payees: [
        { id: 'p-grab', name: 'Grab' },
        { id: 'p-fp', name: 'FairPrice' },
        { id: 'p-mum', name: 'Mum' },
      ],
      accounts: [{ id: 'a-citi', name: 'Citi Card', subtype: 'credit_card' } as FloorEntities['accounts'][number]],
    };

    it('"on grab": an exact payee beats the synonym reading (Transport), and only one is sent', () => {
      expect(resolveFloorQueryCall('how much did I spend on grab last week', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'last_week', payee: 'grab' },
      });
    });

    it('the same text without lists keeps the old category reading', () => {
      expect(resolveFloorQueryCall('how much did I spend on grab last week', NOW)).toEqual({
        tool: 'total_spent',
        params: { period: 'last_week', category: 'grab' },
      });
    });

    it('a name that is exactly both a category and a payee stands aside', () => {
      const both: FloorEntities = { ...LISTS, categories: [...LISTS.categories, { id: 'c-grab', name: 'Grab', kind: 'expense' }] };
      expect(resolveFloorQueryCall('how much did I spend on grab last week', NOW, both)).toBeNull();
    });

    it('the phrase left after the question words is the name ("eating out" → a category)', () => {
      expect(resolveFloorQueryCall('how much did I spend eating out last month', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'last_month', category: 'eating out' },
      });
    });

    it('"<name> cost me" reads the payee', () => {
      expect(resolveFloorQueryCall('how much did grab cost me this month', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'this_month', payee: 'grab' },
      });
    });

    it('a terse account name reads the account', () => {
      expect(resolveFloorQueryCall('citi card this month?', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'this_month', account: 'citi card' },
      });
    });

    it('a compound phrase falls back to its head noun on an exact match only', () => {
      expect(resolveFloorQueryCall('hawker food this month?', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'this_month', category: 'food' },
      });
      // "bus" reaches Transport only through the synonym table: not enough for a head noun.
      expect(resolveFloorQueryCall('school bus this month?', NOW, LISTS)).toBeNull();
    });

    it('a name nothing resolves, or scattered leftover words, stand aside', () => {
      expect(resolveFloorQueryCall('how much did I spend on zorblax last month', NOW, LISTS)).toBeNull();
      expect(resolveFloorQueryCall('how much did I really spend there last month', NOW, LISTS)).toBeNull();
    });

    it('no leftover name, or a sentinel word, is no filter', () => {
      expect(resolveFloorQueryCall('how much did I spend this month', NOW, LISTS)).toEqual({ tool: 'total_spent', params: { period: 'this_month' } });
      expect(resolveFloorQueryCall('how much did I spend on everything this month', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'this_month' },
      });
    });

    it('"at X" keeps its payee reading and no leftover phrase is read beside it', () => {
      expect(resolveFloorQueryCall('how much did I spend at fairprice last month', NOW, LISTS)).toEqual({
        tool: 'total_spent',
        params: { period: 'last_month', payee: 'fairprice' },
      });
    });

    it('income from a named giver is that payee\'s income when the lists name the payee, else stands aside', () => {
      expect(resolveFloorQueryCall('how much did mum give me this year', NOW, LISTS)).toEqual({
        tool: 'total_income',
        params: { period: 'this_year', payee: 'mum' },
      });
      expect(resolveFloorQueryCall('how much did my mum give me this year', NOW, LISTS)).toEqual({
        tool: 'total_income',
        params: { period: 'this_year', payee: 'mum' },
      });
      // Without the lists the floor cannot tell a payee from anything else.
      expect(resolveFloorQueryCall('how much did mum give me this year', NOW)).toBeNull();
      // Nothing resolves the giver, or it is an income category: stand aside.
      expect(resolveFloorQueryCall('how much did zorblax give me this year', NOW, LISTS)).toBeNull();
      expect(resolveFloorQueryCall('income from allowance this year', NOW, LISTS)).toBeNull();
      expect(resolveFloorQueryCall('how much income this year', NOW, LISTS)).toEqual({ tool: 'total_income', params: { period: 'this_year' } });
    });
  });
});
