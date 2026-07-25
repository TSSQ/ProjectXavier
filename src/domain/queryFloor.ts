/**
 * The no-engine query floor (docs/design/ask-xavier-queries-spec.md §5.3
 * point 3) — canned, regex-level deterministic patterns for the handful of
 * shapes real users ask most, straight to a tool call, with NO model
 * involved at all (offline, no BYOK key, FM incapable). Deliberately narrow:
 * this is the last resort, not a general parser — a query-gate hit
 * (`detectQueryIntent`) this floor can't confidently map to a tool should
 * fall through to the caller's own honest "I can answer things like…" reply
 * (app/(tabs)/index.tsx), never a guess.
 *
 * ── QA device bug (build 57) ────────────────────────────────────────────
 * This file's own period detection used to be a SEPARATE, narrower copy of
 * the relative-phrase logic (no explicit-year support at all) — "how much
 * income for year 2026" on the floor would have silently defaulted to
 * `this_month` exactly like the model tiers did. `detectPeriod` now defers
 * entirely to `src/domain/periodRange.ts`'s shared
 * `resolvePeriodFromText` (falling back to `this_month` only when the text
 * states no period at all), so the floor, FM, and BYOK tiers all resolve a
 * period the SAME deterministic way.
 *
 * ── QA MAJOR 2 follow-up: net_worth never got a period at all ─────────────
 * The `net_worth` branch below only ever set `series`, never `asOf` — so on
 * the floor (no engine at all), "what was my net worth in 2020" / "net worth
 * last year" silently returned the CURRENT net worth, with no note that a
 * stated period was ignored. Unlike the other branches, `net_worth`'s period
 * (`asOf`) is OPTIONAL and must NOT default to `this_month` when nothing was
 * stated (omitting it means "right now", a real and different answer) — so
 * this branch reads the UNDEFAULTED `resolvePeriodFromText` result directly
 * rather than `detectPeriod`'s defaulted one.
 */
import { QueryToolCall } from './queryTools';
import { PeriodSpec, resolvePeriodFromText } from './periodRange';

function detectPeriod(t: string, now: number): PeriodSpec {
  return resolvePeriodFromText(t, now) ?? 'this_month';
}

/** A single content word right after "on"/"for" — the floor's only
 *  category-extraction attempt ("spent this month on dining" -> "dining").
 *  Anything more complex than one word falls through to the ladder's other
 *  engines, which have the real matchers to work with. */
function detectCategoryWord(t: string): string | undefined {
  const m = /\b(?:on|for) ([a-z]+)\b/.exec(t);
  const word = m?.[1];
  if (!word) return undefined;
  // "this"/"last" catch "on this month"/"for last week" style phrasing that
  // isn't a category at all.
  if (word === 'this' || word === 'last' || word === 'my') return undefined;
  return word;
}

/** QA BUG 4 (device testing, build 55): "where did my money go" / "what did
 *  I spend on" (with no category named) is asking for the WHOLE breakdown
 *  (the donut), not a single total — sharpened past the original literal
 *  "where did my money go" phrase to also catch "where DOES my money go" /
 *  "where's my money GOING" / "where did MY MONEY go" generally
 *  (`WHERE_MONEY_RE`, any "where ... money" ordering) and a bare "what did I
 *  spend on" with nothing named after "on" (`WHAT_SPEND_ON_BARE_RE` — "what
 *  did I spend on FOOD" still falls through to the generic total_spent
 *  branch below via `detectCategoryWord`, since a category WAS named). */
const BREAKDOWN_WORD_RE = /\bbreakdown\b/;
const WHERE_MONEY_RE = /\bwhere\b.*\bmoney\b/;
const WHAT_SPEND_ON_BARE_RE = /\bwhat\b.*\bspend\b.*\bon\b\W*$/;

function isSpendingBreakdownQuestion(t: string): boolean {
  return BREAKDOWN_WORD_RE.test(t) || WHERE_MONEY_RE.test(t) || WHAT_SPEND_ON_BARE_RE.test(t);
}

/**
 * Resolve free text straight to a tool call using only the top canned
 * shapes: net worth, spending breakdown, income, and total spent (+ optional
 * period/category word) — or `null` when the text doesn't match any of
 * them, in which case the caller should answer honestly rather than guess.
 * `now` is injected (never `Date.now()` read inside) so an explicit-year
 * period can be range-checked against the device's real clock.
 */
export function resolveFloorQueryCall(text: string, now: number): QueryToolCall | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const period = detectPeriod(t, now);

  if (/\bnet worth\b/.test(t)) {
    const series = /\b(trend|history|over time)\b/.test(t);
    // `asOf` is genuinely OPTIONAL (omitted = "right now") — only set it
    // when the text actually states a period; never default it the way
    // `period` above defaults to `this_month` for the other branches.
    const asOf = resolvePeriodFromText(t, now);
    return { tool: 'net_worth', params: asOf ? { series, asOf } : { series } };
  }
  if (isSpendingBreakdownQuestion(t)) {
    return { tool: 'spending_by_category', params: { period } };
  }
  if (/\b(income|earned|earnings)\b/.test(t)) {
    return { tool: 'total_income', params: { period } };
  }
  if (/\b(spent|spending|spend)\b/.test(t)) {
    return { tool: 'total_spent', params: { period, category: detectCategoryWord(t) } };
  }
  return null;
}
