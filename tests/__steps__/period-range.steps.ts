/**
 * BDD suite for src/domain/periodRange.ts (docs/design/ask-xavier-queries-
 * spec.md §5.2/§7 acceptance #2). Plain jest (mirrors the allowance already
 * used by tests/__steps__/intent-corpus.steps.ts) — TZ-pinned via
 * jest.config.js's default `TZ=UTC` (the same convention every other
 * date/period suite in this repo relies on; see src/domain/period.ts's own
 * local-calendar tests for the pattern this mirrors).
 */
import { resolvePeriodRange, PERIOD_TOKENS } from '../../src/domain/periodRange';

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
});
