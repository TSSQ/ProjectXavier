/**
 * BDD suite for src/domain/periodRange.ts (docs/design/ask-xavier-queries-
 * spec.md §5.2/§7 acceptance #2). Plain jest (mirrors the allowance already
 * used by tests/__steps__/intent-corpus.steps.ts) — TZ-pinned via
 * jest.config.js's default `TZ=UTC` (the same convention every other
 * date/period suite in this repo relies on; see src/domain/period.ts's own
 * local-calendar tests for the pattern this mirrors).
 */
import { resolvePeriodRange, resolvePeriodFromText, PERIOD_TOKENS } from '../../src/domain/periodRange';

// A fixed "now" — Wednesday 15 July 2026, 10:30 UTC — chosen mid-month/
// mid-week/mid-year so every boundary below is unambiguous.
const NOW = Date.UTC(2026, 6, 15, 10, 30, 0);

describe('resolvePeriodRange', () => {
  it('this_month covers the whole calendar month containing now', () => {
    const range = resolvePeriodRange('this_month', NOW);
    expect(range.start).toBe(Date.UTC(2026, 6, 1, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 7, 1, 0, 0, 0));
  });

  it('last_month covers the whole PREVIOUS calendar month', () => {
    const range = resolvePeriodRange('last_month', NOW);
    expect(range.start).toBe(Date.UTC(2026, 5, 1, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 6, 1, 0, 0, 0));
  });

  it('last_month resolves to the FULL previous month even on the 1st (no zero-length range)', () => {
    const firstOfMonth = Date.UTC(2026, 6, 1, 0, 0, 0);
    const range = resolvePeriodRange('last_month', firstOfMonth);
    expect(range.start).toBe(Date.UTC(2026, 5, 1, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 6, 1, 0, 0, 0));
  });

  it('this_week covers Monday..Sunday of the current ISO week', () => {
    const range = resolvePeriodRange('this_week', NOW);
    // 15 July 2026 is a Wednesday; the week's Monday is the 13th.
    expect(range.start).toBe(Date.UTC(2026, 6, 13, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 6, 20, 0, 0, 0));
  });

  it('last_week covers the whole PREVIOUS ISO week', () => {
    const range = resolvePeriodRange('last_week', NOW);
    expect(range.start).toBe(Date.UTC(2026, 6, 6, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 6, 13, 0, 0, 0));
  });

  it('this_year covers Jan 1..Dec 31 of the current year', () => {
    const range = resolvePeriodRange('this_year', NOW);
    expect(range.start).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2027, 0, 1, 0, 0, 0));
  });

  it('last_year covers the whole PREVIOUS calendar year', () => {
    const range = resolvePeriodRange('last_year', NOW);
    expect(range.start).toBe(Date.UTC(2025, 0, 1, 0, 0, 0));
    expect(range.end).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  it('all_time starts at epoch 0 and ends (exclusive) just after now', () => {
    const range = resolvePeriodRange('all_time', NOW);
    expect(range.start).toBe(0);
    expect(range.end).toBe(NOW + 1);
  });

  it('a transaction occurring at exactly now is included in all_time (exclusive-end convention)', () => {
    const range = resolvePeriodRange('all_time', NOW);
    expect(NOW >= range.start && NOW < range.end).toBe(true);
  });

  it('every token resolves to a well-formed range (start < end) for a fixed now', () => {
    for (const token of PERIOD_TOKENS) {
      const range = resolvePeriodRange(token, NOW);
      expect(range.start).toBeLessThan(range.end);
    }
  });

  it('is pure: calling twice with the same inputs gives identical results', () => {
    const a = resolvePeriodRange('this_month', NOW);
    const b = resolvePeriodRange('this_month', NOW);
    expect(a).toEqual(b);
  });

  // QA BLOCKER follow-up: a malformed BYOK tool call missing `period`
  // entirely used to reach `token.startsWith(...)` on `undefined` and THROW.
  it('never throws on a missing (undefined) token — falls back to a well-formed range', () => {
    expect(() => resolvePeriodRange(undefined as unknown as 'this_month', NOW)).not.toThrow();
    const range = resolvePeriodRange(undefined as unknown as 'this_month', NOW);
    expect(range.start).toBeLessThan(range.end);
  });

  it('never throws on an unrecognised token string — falls back to a well-formed range', () => {
    expect(() => resolvePeriodRange('fortnight' as unknown as 'this_month', NOW)).not.toThrow();
    const range = resolvePeriodRange('fortnight' as unknown as 'this_month', NOW);
    expect(range.start).toBeLessThan(range.end);
  });

  // QA device bug (build 57): "how much income for year 2026" answered
  // "Total income, THIS MONTH" — resolvePeriodRange must be able to express
  // (and correctly range) an explicit calendar year.
  describe('an explicit year period', () => {
    it('covers Jan 1 00:00:00.000 through Dec 31 23:59:59.999 (local), exclusive end', () => {
      const range = resolvePeriodRange({ kind: 'year', year: 2026 }, NOW);
      expect(range.start).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
      expect(range.end).toBe(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
      // The last representable instant in the year is included (end exclusive).
      expect(range.end - 1).toBe(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
    });

    it('a PAST year (2025) resolves to a DIFFERENT range than this_year (2026)', () => {
      const year2025 = resolvePeriodRange({ kind: 'year', year: 2025 }, NOW);
      const thisYear = resolvePeriodRange('this_year', NOW);
      expect(year2025).not.toEqual(thisYear);
      expect(year2025.start).toBe(Date.UTC(2025, 0, 1));
      expect(year2025.end).toBe(Date.UTC(2026, 0, 1));
    });
  });

  // QA MINOR (device testing, build 57 re-gate): "March 2025" used to
  // silently fall back to the WHOLE YEAR — resolvePeriodRange must express
  // (and correctly range) a single explicit calendar month.
  describe('an explicit month period', () => {
    it('March 2025 covers March 1 00:00:00.000 through March 31 23:59:59.999, exclusive end', () => {
      const range = resolvePeriodRange({ kind: 'month', year: 2025, month: 2 }, NOW);
      expect(range.start).toBe(Date.UTC(2025, 2, 1, 0, 0, 0, 0));
      expect(range.end).toBe(Date.UTC(2025, 3, 1, 0, 0, 0, 0));
      expect(range.end - 1).toBe(Date.UTC(2025, 2, 31, 23, 59, 59, 999));
    });

    it('a month is a STRICT subset of its containing year (never mistaken for the whole year)', () => {
      const march2025 = resolvePeriodRange({ kind: 'month', year: 2025, month: 2 }, NOW);
      const year2025 = resolvePeriodRange({ kind: 'year', year: 2025 }, NOW);
      expect(march2025.start).toBeGreaterThan(year2025.start);
      expect(march2025.end).toBeLessThan(year2025.end);
    });
  });
});

describe('resolvePeriodFromText', () => {
  it('returns null when the text states no period at all', () => {
    expect(resolvePeriodFromText('how much did I spend', NOW)).toBeNull();
    expect(resolvePeriodFromText('what is my net worth', NOW)).toBeNull();
  });

  it('recognises every relative-phrase token', () => {
    expect(resolvePeriodFromText('how much did I spend this month', NOW)).toBe('this_month');
    expect(resolvePeriodFromText('how much did I spend last month', NOW)).toBe('last_month');
    expect(resolvePeriodFromText('how much did I spend this week', NOW)).toBe('this_week');
    expect(resolvePeriodFromText('how much did I spend last week', NOW)).toBe('last_week');
    expect(resolvePeriodFromText('how much did I spend this year', NOW)).toBe('this_year');
    expect(resolvePeriodFromText('how much did I spend last year', NOW)).toBe('last_year');
    expect(resolvePeriodFromText('how much have I spent all time', NOW)).toBe('all_time');
  });

  it('recognises an explicit year in several phrasings', () => {
    expect(resolvePeriodFromText('how much income for year 2026', NOW)).toEqual({
      kind: 'year',
      year: 2026,
    });
    expect(resolvePeriodFromText('how much did I spend in 2025', NOW)).toEqual({
      kind: 'year',
      year: 2025,
    });
    expect(resolvePeriodFromText('2024', NOW)).toEqual({ kind: 'year', year: 2024 });
    expect(resolvePeriodFromText('how much did I spend in FY2025', NOW)).toEqual({
      kind: 'year',
      year: 2025,
    });
  });

  it('does NOT treat a stated AMOUNT that happens to look like a year as a period', () => {
    expect(resolvePeriodFromText('I spent $2026 on rent', NOW)).toBeNull();
    expect(resolvePeriodFromText('I spent 2026 dollars on rent', NOW)).toBeNull();
  });

  it('rejects an out-of-range year (never a plausible query period)', () => {
    expect(resolvePeriodFromText('how much did I spend in 1200', NOW)).toBeNull();
  });

  it('rejects a year further in the future than "next year" (now + 1)', () => {
    // NOW is July 2026, so 2028+ is out of the accepted [1990, thisYear+1] bound.
    expect(resolvePeriodFromText('how much will I spend in 2028', NOW)).toBeNull();
  });

  it('is pure and TZ-pinned: calling twice with the same inputs gives identical results', () => {
    const a = resolvePeriodFromText('how much did I spend in 2025', NOW);
    const b = resolvePeriodFromText('how much did I spend in 2025', NOW);
    expect(a).toEqual(b);
  });

  // QA MAJOR 1 (regression introduced by the build-57 fix): a COMPARISON
  // question states TWO distinct periods — the deterministic override must
  // step aside (null) and let the model's own per-round choice stand,
  // otherwise a multi-round comparison collapses onto one winner.
  describe('a COMPARISON (two or more distinct periods) returns null (QA MAJOR 1)', () => {
    it('"compare my spending this month vs last month" -> null', () => {
      expect(resolvePeriodFromText('compare my spending this month vs last month', NOW)).toBeNull();
    });

    it('"2025 vs 2026" -> null', () => {
      expect(resolvePeriodFromText('compare 2025 vs 2026', NOW)).toBeNull();
    });

    it('"this year and last year" -> null', () => {
      expect(resolvePeriodFromText('compare this year and last year', NOW)).toBeNull();
    });

    it('the SAME period mentioned twice is NOT a comparison — still resolves', () => {
      expect(resolvePeriodFromText('this month is looking good, how did this month go', NOW)).toBe(
        'this_month'
      );
    });

    it('a single-period question (no comparison) is unaffected', () => {
      expect(resolvePeriodFromText('how much did I spend this month', NOW)).toBe('this_month');
      expect(resolvePeriodFromText('how much did I spend in 2025', NOW)).toEqual({
        kind: 'year',
        year: 2025,
      });
    });
  });

  // QA MINOR (device testing, build 57 re-gate): explicit months.
  describe('an explicit month', () => {
    it('"March 2025" -> that exact month', () => {
      expect(resolvePeriodFromText('how much did I spend in March 2025', NOW)).toEqual({
        kind: 'month',
        year: 2025,
        month: 2,
      });
    });

    it('"Jan 2024" (abbreviated) -> that exact month', () => {
      expect(resolvePeriodFromText('how much did I spend in Jan 2024', NOW)).toEqual({
        kind: 'month',
        year: 2024,
        month: 0,
      });
    });

    it('"in March" (no year) -> the most recent past/current March relative to now', () => {
      // NOW is July 2026 — March 2026 has already occurred this year.
      expect(resolvePeriodFromText('how much did I spend in March', NOW)).toEqual({
        kind: 'month',
        year: 2026,
        month: 2,
      });
    });

    it('"in March" when now is BEFORE March this year -> falls back to last year\'s March', () => {
      const januaryNow = Date.UTC(2026, 0, 15); // 15 Jan 2026 — March 2026 hasn't happened yet.
      expect(resolvePeriodFromText('how much did I spend in March', januaryNow)).toEqual({
        kind: 'month',
        year: 2025,
        month: 2,
      });
    });

    it('"March 2025" does NOT also register "2025" as a separate bare-year candidate', () => {
      // If it did, candidates would be [month:2025-2, year:2025] — two
      // DISTINCT keys — and the whole thing would wrongly resolve to null
      // (misread as a comparison) instead of the single month.
      const result = resolvePeriodFromText('how much did I spend in March 2025', NOW);
      expect(result).not.toBeNull();
      expect((result as { kind: string }).kind).toBe('month');
    });
  });

  // QA MINOR: accepted gaps — anything we don't model returns null (never a
  // confidently-WRONG wider range), and a proper-noun/product-name collision
  // must not be misread as a year either.
  describe('accepted gaps — never a silently-wrong wider range', () => {
    it('"Q1 2026" -> null (quarters are not modeled; must NOT silently widen to the whole year)', () => {
      expect(resolvePeriodFromText('how much did I spend in Q1 2026', NOW)).toBeNull();
    });

    it('"since 2020" -> null (an open-ended range is not modeled as a single year)', () => {
      expect(resolvePeriodFromText('how much have I spent since 2020', NOW)).toBeNull();
    });

    it('"between March and May" -> null (explicit ranges are not modeled)', () => {
      expect(resolvePeriodFromText('how much did I spend between March and May', NOW)).toBeNull();
    });

    it('"flight to 2026 conference" -> does NOT extract 2026 as a year (proper-noun collision)', () => {
      expect(resolvePeriodFromText('I booked a flight to 2026 conference', NOW)).toBeNull();
    });
  });
});
