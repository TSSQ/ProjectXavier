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
 *
 * ── RULE: no gate change without a corpus case first ──
 * Mirrors the intent gate's own rule (src/domain/queryIntent.ts's header):
 * this file's own device-bug history above (build 55, build 57) shows this
 * "canned patterns" router accretes edge cases exactly like a hand-tuned
 * regex gate. ANY change to which tool/period/category a pattern below
 * resolves to -- a new keyword, a widened regex, a narrowed exclusion --
 * must land with a new labeled line in `tests/query-corpus.jsonl` FIRST (a
 * case that fails on the OLD code, passes on the NEW code), not just a code
 * diff. `npm run eval:query` (evals-lite/query-report.mjs) is the
 * human-readable pass/fail surface for that corpus.
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

/** eval-driven fix (tests/query-corpus.jsonl): "how much did I earn last
 *  year" / "what did I earn last month" used to fall through to `null`
 *  entirely — the income keyword set only ever covered "income"/"earned"/
 *  "earnings" (past tense / noun forms), never bare present-tense "earn".
 *  Widened to include it; this is still a plain keyword set, not a real
 *  verb-conjugation matcher (e.g. "earning" isn't covered either), but "earn"
 *  is the single most obviously-missing, most natural form. */
const INCOME_WORD_RE = /\b(income|earn|earned|earnings)\b/;

/** eval-driven fix (tests/query-corpus.jsonl): "show my spending trend" /
 *  "how has my spending changed over time" / "average spend over the last 6
 *  months" used to MIS-ROUTE to `total_spent` (a confidently wrong single
 *  this_month figure) because the total_spent branch's keyword set
 *  (`spent`/`spend`/`spending`) fires on any of those phrases too. The floor
 *  doesn't implement `spending_over_time` at all (see this module's header —
 *  deliberately narrow), so per its own "never guess" doctrine it must STAND
 *  ASIDE (return `null`, letting the caller's honest "I can answer things
 *  like…" reply show) rather than answer a trend/average question with a
 *  single total. This is intentionally a small, keyword-based guard — not an
 *  attempt to implement trend detection — scoped to the language actually
 *  seen in the corpus/device bugs so it doesn't swallow legitimate
 *  single-total questions ("how much did I spend on dining last month",
 *  "total spent in 2025" — neither carries any of these words). */
const TREND_OR_AVERAGE_RE =
  /\b(trend|trending|over time|month over month|by month|each month|per month|average|avg|breakdown by month|changed over)\b/;

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
  if (INCOME_WORD_RE.test(t)) {
    return { tool: 'total_income', params: { period } };
  }
  if (/\b(spent|spending|spend)\b/.test(t)) {
    // Stand aside on a trend/average question rather than guess — see
    // TREND_OR_AVERAGE_RE's header.
    if (TREND_OR_AVERAGE_RE.test(t)) return null;
    return { tool: 'total_spent', params: { period, category: detectCategoryWord(t) } };
  }
  return null;
}
