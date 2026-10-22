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
 *
 * ── Question eval D2 (evals/questions.jsonl): wider, still never guessing ──
 * The question eval scores the floor end to end (right tool, period, filters
 * AND the final number over a fixed ledger), and found it answering 45 of 95
 * dev questions. What it now also serves, each with a query-corpus case:
 * a bare "total"/"how much" (a spend total); multi-word names ("dining out")
 * and the filter a preposition implies ("at X" payee, "on my X"/"from X"
 * account, "on/for X" or "X spend"/"X income" category); a terse "groceries
 * last month?"; category rankings ("by category", "which category … most");
 * series questions with `spending_over_time` (trend/over time/daily/weekly/
 * monthly/per week, a chart/graph lead); payee rankings with `top_payees`
 * ("top 5 payees", "who did I pay the most"); and net worth asked without
 * the words ("how much money do I have"). It still stands aside on an
 * average, on a union of two names ("food and transport" — one call cannot
 * answer it), and on every `search_transactions` shape. Names stay free
 * text: what does not resolve exactly runs unfiltered with a note (see
 * queryTools.ts), so synonyms ("eating out") remain a recorded gap.
 */
import { QueryToolCall, SeriesGranularity } from './queryTools';
import { PeriodSpec, resolvePeriodFromText } from './periodRange';

function detectPeriod(t: string, now: number): PeriodSpec {
  return resolvePeriodFromText(t, now) ?? 'this_month';
}

/** Words that end a name phrase ("on dining out LAST month") — period and
 *  grouping words, never part of a category/payee/account name. */
const NAME_STOP_RE =
  /^(this|last|past|in|during|since|so|today|yesterday|ytd|per|by|over|vs|versus|and|or|the|a|my|of|on|at|for|from|ever|overall|all|each|every|year|month|week|day|quarter)$/;

const MONTH_WORDS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec',
]);

/** Up to three words after `lead` ("on", "at", …), stopping at the first
 *  period/grouping word, a digit or punctuation — or `undefined` when the
 *  phrase is empty, a month name ("for oct" is a period), or a union ("on
 *  food AND transport": see `isUnion`). Question eval D2: the floor used to
 *  read ONE word after "on"/"for" only, so "dining out" became "dining". */
function namePhraseAfter(t: string, lead: RegExp): string | undefined {
  const m = lead.exec(t);
  if (!m) return undefined;
  const words: string[] = [];
  const rest = t.slice(m.index + m[0].length).replace(/^(?:the|a|an)\s+/, '');
  for (const raw of rest.split(/\s+/)) {
    const w = raw.replace(/[?!.,]+$/, '');
    if (!w || !/^[a-z0-9][a-z0-9'&-]*$/.test(w) || !/[a-z]/.test(w) || NAME_STOP_RE.test(w)) break;
    words.push(w);
    if (w !== raw || words.length === 3) break; // trailing punctuation ends the phrase
  }
  if (words.length === 0 || MONTH_WORDS.has(words[0]!)) return undefined;
  return words.join(' ');
}

/** "on/for X" — a category. "on my X" is an account (see `detectFilters`). */
function detectCategoryWord(t: string): string | undefined {
  return namePhraseAfter(t, /\b(?:on|for)\s+(?!my\b)/);
}

/** The floor's whole filter reading (question eval D2): "at X" is a payee,
 *  "on my X" / "from X" an account, "on/for X" a category. Every name is
 *  re-resolved by the tool (src/domain/queryTools.ts); one that does not
 *  resolve runs unfiltered with a "couldn't find" note, never silently. */
function detectFilters(t: string): { category?: string; payee?: string; account?: string } {
  const payee = namePhraseAfter(t, /\bat\s+/) ?? namePhraseAfter(t, /\b(?:paid|pay)\s+/);
  const account = namePhraseAfter(t, /\b(?:on my|from(?: my)?)\s+/);
  const category = detectCategoryWord(t) ?? categoryBefore(t, SPEND_NOUN_RE);
  return {
    ...(category ? { category } : {}),
    ...(payee ? { payee } : {}),
    ...(account ? { account } : {}),
  };
}

/** Words that sit right before "spend"/"income" without naming a category
 *  ("TOTAL spending", "MONTHLY spending", "MY income"). */
const NOT_A_NAME_RE =
  /^(total|my|our|the|monthly|weekly|daily|average|avg|overall|all|net|gross|much|i|did|do|what|how|show|graph|chart|list|of|on|for|in)$/;
const SPEND_NOUN_RE = /\s+(?:spend|spending)\b/;
const INCOME_NOUN_RE = /\s+income\b/;

/** The single word right before `noun` ("FOOD spend", "FREELANCE income") —
 *  question eval D2: terse questions name the category that way. */
function categoryBefore(t: string, noun: RegExp): string | undefined {
  const m = new RegExp(`(?:^|\\s)([a-z][a-z'&-]*)${noun.source}`).exec(t);
  const word = m?.[1];
  return word && !NOT_A_NAME_RE.test(word) ? word : undefined;
}

/** "groceries last month?" — a bare name, a period, a question mark: that
 *  category's total (question eval D2). The name is at most three words. */
const TERSE_NAME_PERIOD_RE = /^([a-z][a-z'&-]*(?: [a-z][a-z'&-]*){0,2})\s+(?:this|last)\s+(?:week|month|year)\s*\?$/;

/** Net worth asked without the words "net worth" (question eval D2). */
const NET_WORTH_RE =
  /\bnet worth\b|\bam i worth\b|\bhow much money do i have\b|\b(?:total )?balance (?:across|of|on) all(?: my)? accounts\b/;

/** "on food and transport": two names in one question — the floor makes one
 *  call, so it stands aside rather than answer for the first name alone. */
const UNION_RE = /\b(?:on|for|at)\s+[a-z][a-z' ]*?(?:\s+(?:and|or|&|vs|versus)\s+|\s*,\s*)[a-z]/;
/** A union word inside a terse "<name> <period>?" capture ("food and transport"). */
const UNION_WORD_RE = /\b(?:and|or|vs|versus)\b|[&,]/;

/** No budget tool exists: a budget comparison is not a spending total. */
const BUDGET_RE = /\bbudgets?\b/;

/** Period words `resolvePeriodFromText` cannot read yet (question eval D2
 *  review): with one of these and no resolved period, answering would
 *  silently substitute this_month — so the floor stands aside. ("may" is
 *  left out: far more often a verb.) Also an explicit year or a
 *  "this/last month"-style phrase (an amount like "$2026" is not a year): when the resolver returns null for text
 *  that has one, the text names TWO periods (a comparison — "2025 vs 2026",
 *  "this month vs last month") that one call cannot answer. Since questions
 *  route floor-first (src/domain/parseRouter.ts `routeQueryEngines`), a
 *  this_month answer here would pre-empt the BYOK loop's comparison chart. */
const UNREAD_PERIOD_RE =
  /\b(?:today|yesterday|ytd|year to date|q[1-4]|quarter|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|(?<![$€£¥])(?:19|20)\d{2}|(?:this|last|past|next) (?:week|month|year))\b/;

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
const WHAT_SPEND_ON_BARE_RE =
  /\bwhat\b.*\bspend\b.*\bon\b\W*(?:(?:this|last)\s+(?:week|month|year)|in\s+\w+(?:\s+\d{4})?|\d{4})?\W*$/;
/** Question eval D2: a category RANKING ("by category", "which category …
 *  the most", "biggest categories", a bare "categories") is the breakdown. */
const CATEGORY_RANKING_RE = /\bby categor(?:y|ies)\b|\bwhich categor(?:y|ies)\b|\b(?:biggest|top|largest) categories\b|^categories\b/;

function isSpendingBreakdownQuestion(t: string): boolean {
  return (
    BREAKDOWN_WORD_RE.test(t) ||
    WHERE_MONEY_RE.test(t) ||
    WHAT_SPEND_ON_BARE_RE.test(t) ||
    CATEGORY_RANKING_RE.test(t)
  );
}

/** eval-driven fix (tests/query-corpus.jsonl): "how much did I earn last
 *  year" / "what did I earn last month" used to fall through to `null`
 *  entirely — the income keyword set only ever covered "income"/"earned"/
 *  "earnings" (past tense / noun forms), never bare present-tense "earn".
 *  Widened to include it; this is still a plain keyword set, not a real
 *  verb-conjugation matcher (e.g. "earning" isn't covered either), but "earn"
 *  is the single most obviously-missing, most natural form. */
const INCOME_WORD_RE = /\b(income|earn|earned|earnings|gave me|give me|came in|got paid|(?:get|got|received?) from)\b/;

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

/** Question eval D2: the floor now SERVES the series shapes with
 *  `spending_over_time` instead of standing aside — every trend word above
 *  except an average (no tool computes one), plus the bucket words
 *  "daily/weekly/monthly", "per/by/each day/week", and a chart/graph lead. An
 *  average still stands aside. */
const AVERAGE_RE = /\b(average|avg)\b/;
const SERIES_RE =
  /\b(trend|trending|over time|month over month|changed over|daily|weekly|monthly|(?:per|by|each) (?:day|week|month))\b|^(?:chart|graph)\b/;

/** The bucket a series question names, else one that suits its period. */
function seriesGranularity(t: string, period: PeriodSpec): SeriesGranularity {
  if (/\b(daily|(?:per|by|each) day)\b/.test(t)) return 'day';
  if (/\b(weekly|(?:per|by|each) week)\b/.test(t)) return 'week';
  if (/\b(monthly|(?:per|by|each) month|month over month)\b/.test(t)) return 'month';
  if (period === 'this_week' || period === 'last_week') return 'day';
  if (period === 'this_month' || period === 'last_month') return 'week';
  if (typeof period === 'object' && period.kind === 'month') return 'week';
  return 'month';
}

/** Question eval D2: payee rankings ("top 5 payees", "who did I pay the
 *  most", "which shops did I spend the most at") — `top_payees`, with the
 *  stated count (1-10), else 5. */
const TOP_PAYEES_RE =
  /\b(?:top|biggest|largest)\s+(?:\d{1,2}\s+)?(?:payees?|merchants?|shops?|stores?)\b|\bwho (?:did|do) i pay the most\b|\bwho are my top\b|\b(?:shops?|stores?|merchants?|payees?)\b.*\bthe most\b/;

function topCount(t: string): number {
  const m = /\btop\s+(\d{1,2})\b/.exec(t);
  const n = m ? Number(m[1]) : 5;
  return Math.min(10, Math.max(1, n));
}

/** Question eval D2: a bare "total" ("total oct", "total last month") and a
 *  bare "how much" (with no income/worth word) both ask for a spend total. */
const SPEND_TOTAL_RE =
  /\b(spent|spending|spend|total|cost)\b|^how much (?:on|at|for|in|during|this|last|so far|since)\b|^how much\W*$|^how much\b.*\b(?:paid|pay)\b/;

/** A series needs something to chart: a spend word, or an explicit trend. A
 *  bare "monthly" ("my monthly salary", "my monthly rent") is not one. */
const SERIES_SUBJECT_RE = /\b(spen[dt]|spending|expenses?|trend|trending|over time|changed over)\b|^(?:chart|graph)\b/;

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
  // A period the resolver cannot read must never quietly become this_month.
  if (UNREAD_PERIOD_RE.test(t) && !resolvePeriodFromText(t, now)) return null;
  const period = detectPeriod(t, now);

  if (NET_WORTH_RE.test(t)) {
    const series = /\b(trend|history|over time)\b/.test(t);
    // `asOf` is genuinely OPTIONAL (omitted = "right now") — only set it
    // when the text actually states a period; never default it the way
    // `period` above defaults to `this_month` for the other branches.
    const asOf = resolvePeriodFromText(t, now);
    return { tool: 'net_worth', params: asOf ? { series, asOf } : { series } };
  }
  // Two names in one question: one call can't answer it (question eval D2).
  if (UNION_RE.test(t) || BUDGET_RE.test(t)) return null;
  if (TOP_PAYEES_RE.test(t)) {
    return { tool: 'top_payees', params: { period, n: topCount(t) } };
  }
  if (isSpendingBreakdownQuestion(t)) {
    return { tool: 'spending_by_category', params: { period } };
  }
  if (INCOME_WORD_RE.test(t)) {
    // total_income filters by category only: income FROM someone stands aside.
    if (namePhraseAfter(t, /\bfrom\s+/)) return null;
    const category = detectCategoryWord(t) ?? categoryBefore(t, INCOME_NOUN_RE);
    return { tool: 'total_income', params: { period, ...(category ? { category } : {}) } };
  }
  const series = SERIES_RE.test(t) && SERIES_SUBJECT_RE.test(t);
  if (SPEND_TOTAL_RE.test(t) || series) {
    // Stand aside on an average rather than guess — see TREND_OR_AVERAGE_RE.
    if (AVERAGE_RE.test(t)) return null;
    if (series) {
      const category =
        detectCategoryWord(t) ?? namePhraseAfter(t, /\b(?:trend|graph|chart) of\s+/) ?? categoryBefore(t, SPEND_NOUN_RE);
      return {
        tool: 'spending_over_time',
        params: { period, granularity: seriesGranularity(t, period), ...(category ? { category } : {}) },
      };
    }
    if (TREND_OR_AVERAGE_RE.test(t)) return null;
    return { tool: 'total_spent', params: { period, ...detectFilters(t) } };
  }
  const terse = TERSE_NAME_PERIOD_RE.exec(t);
  if (terse && !UNION_WORD_RE.test(terse[1]!)) return { tool: 'total_spent', params: { period, category: terse[1]! } };
  return null;
}
