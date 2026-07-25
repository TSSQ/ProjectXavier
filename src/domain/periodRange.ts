/**
 * Deterministic period resolver for Ask-Xavier queries
 * (docs/design/ask-xavier-queries-spec.md §5.2). This module is the ONE
 * place a period turns into a real epoch range, mirroring
 * `src/domain/deviceParsePrompt.ts`'s `resolveRelativeDate`/
 * `resolveAbsoluteDate` split (deterministic code owns dates, never the
 * model).
 *
 * Pure and TZ-safe: `now` is always injected by the caller (never
 * `Date.now()` read in here), and every calculation is built on
 * `src/domain/period.ts`'s existing local-calendar helpers
 * (`periodRange`/`startOfPeriod`) — the same "local time, epoch ms, end
 * exclusive" convention the dashboard's drill-down already uses, so a
 * period resolved here always matches what the dashboard would show for the
 * same range.
 *
 * ── QA device bug (build 57): the MODEL was choosing the period ───────────
 * "how much income for year 2026" returned "Total income, THIS MONTH" — a
 * confidently-captioned WRONG figure. Root cause: nothing deterministic ever
 * extracted a period from the user's own words; the model's `period` token
 * (from `queryToolSelection.ts`'s FM schema, or a BYOK tool call) was taken
 * as-is, and `PERIOD_TOKENS` couldn't even EXPRESS an explicit year in the
 * first place — "2026" was inexpressible, so the FM contract's own
 * `.catch('unspecified')` silently defaulted to `this_month`. This is the
 * SAME class of bug the expense parser already solved for DATES
 * (`resolveRelativeDate`/`resolveAbsoluteDate` override the model's date):
 * dates/periods must be deterministic, never model-chosen, whenever the
 * user's own text states one.
 *
 * The fix has two parts:
 *  1. `PeriodSpec` widens the INTERNAL representation (what
 *     `resolvePeriodRange`/the tool executors accept) to also express an
 *     explicit year (`{ kind: 'year', year }`) or an explicit month
 *     (`{ kind: 'month', year, month }`) — but the MODEL-FACING enum
 *     (`PERIOD_TOKENS`, the FM schema's `period` field, the BYOK tool defs'
 *     `period` param) stays EXACTLY the closed token list it always was; the
 *     model still only ever picks a token. An explicit-year/-month
 *     `PeriodSpec` value can ONLY ever come from `resolvePeriodFromText`,
 *     never from a model.
 *  2. `resolvePeriodFromText(text, now)` reads the user's own words and, when
 *     they state EXACTLY ONE period, returns it — the caller
 *     (`app/(tabs)/index.tsx`'s FM/BYOK branches, `queryLoop.ts`'s BYOK loop,
 *     and `queryFloor.ts`) REPLACES whatever period the model/floor chose
 *     with this deterministic result before the tool ever executes. `null`
 *     means either the text states no period at all, or it states MULTIPLE
 *     distinct ones (see the QA MAJOR 1 note below) — in which case the
 *     model's own token (or the documented `this_month` default) applies
 *     unchanged. This function never invents a period the text doesn't
 *     actually contain, and never collapses a genuine multi-period question
 *     onto a single winner.
 *
 * ── QA MAJOR 1 follow-up: a COMPARISON must not be collapsed to one period ─
 * The BYOK tool loop can compose multiple tool calls across rounds — "compare
 * my spending this month vs last month" naturally becomes TWO `total_spent`
 * calls, one per period, exactly the capability multi-round tool use exists
 * for (spec §5.3). The very first cut of this fix broke that: `queryLoop.ts`
 * re-derives `resolvePeriodFromText(text, now)` from the SAME original
 * question on every round and force-applies it, so round 1's `this_month`
 * and round 2's `last_month` (the model's own, CORRECT per-round choices)
 * were both overwritten with whichever single period this function returned
 * — collapsing a two-period comparison into the same period rendered twice.
 *
 * The fix: this function now collects EVERY distinct period the text
 * mentions. Exactly one distinct period → return it (the device-bug case,
 * unchanged). Zero → `null` (nothing stated, unchanged). TWO OR MORE
 * distinct periods ("this month vs last month", "2025 vs 2026", "this year
 * and last year") → `null` — the text is inherently a comparison/multi-period
 * question, and the MODEL's own per-round composition (not a single
 * deterministic guess) is the correct signal for which period belongs to
 * which round. This never re-introduces the original bug: a single-period
 * question still overrides on every round, since `resolvePeriodFromText`
 * returns the SAME single period every time it's called with the same text.
 */
import { periodRange, startOfPeriod, endOfPeriod, PeriodRange, Granularity } from './period';

/** The only period shapes the model may ever choose — every one of these
 *  maps onto a real, unambiguous calendar range for a given `now`. Order is
 *  irrelevant (this is just the type source); see `PERIOD_TOKENS` below for
 *  runtime membership checks (e.g. the query tool-selection schema's enum).
 *  This list is the MODEL-FACING contract and does NOT grow to include an
 *  explicit year/month — see `PeriodSpec`/`resolvePeriodFromText` above. */
export const PERIOD_TOKENS = [
  'this_month',
  'last_month',
  'this_week',
  'last_week',
  'this_year',
  'last_year',
  'all_time',
] as const;

export type PeriodToken = (typeof PERIOD_TOKENS)[number];

/** An explicit calendar YEAR ("2026", "in 2025", "for year 2026") — only
 *  ever produced by `resolvePeriodFromText`, never by a model (see the
 *  module header). Kept as its own tagged shape (not just a bare number) so
 *  it can never be confused with a `PeriodToken` string at the type level. */
export interface ExplicitYearPeriod {
  kind: 'year';
  year: number;
}

/** An explicit calendar MONTH ("March 2025", "in March", "Jan 2024") — only
 *  ever produced by `resolvePeriodFromText`, never by a model. `month` is
 *  0-based (matches `Date`'s own convention — 0 = January), to avoid a
 *  second, driftable "which convention" decision anywhere this is consumed. */
export interface ExplicitMonthPeriod {
  kind: 'month';
  year: number;
  /** 0-based: 0 = January, 11 = December. */
  month: number;
}

/** What every tool executor's `period`/`asOf` param actually accepts — a
 *  model-facing token, OR a deterministically-extracted explicit year/month. */
export type PeriodSpec = PeriodToken | ExplicitYearPeriod | ExplicitMonthPeriod;

/** Granularity `periodRange` needs for each non-`all_time` token — used only
 *  to walk to the PREVIOUS period for the `last_*` tokens. */
const GRANULARITY_FOR: Record<Exclude<PeriodToken, 'all_time'>, Granularity> = {
  this_month: 'month',
  last_month: 'month',
  this_week: 'week',
  last_week: 'week',
  this_year: 'year',
  last_year: 'year',
};

function isExplicitYearPeriod(spec: unknown): spec is ExplicitYearPeriod {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    (spec as { kind?: unknown }).kind === 'year' &&
    typeof (spec as { year?: unknown }).year === 'number'
  );
}

function isExplicitMonthPeriod(spec: unknown): spec is ExplicitMonthPeriod {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    (spec as { kind?: unknown }).kind === 'month' &&
    typeof (spec as { year?: unknown }).year === 'number' &&
    typeof (spec as { month?: unknown }).month === 'number'
  );
}

/** True when `token` is actually one of `PERIOD_TOKENS` at runtime — `token`
 *  is typed `PeriodToken` above, but an UNTRUSTED caller (a BYOK tool call
 *  whose params only shape-checked, not schema-validated — see the QA
 *  blocker note below) can hand this function a value the type system never
 *  really guaranteed. */
function isKnownPeriodToken(token: unknown): token is PeriodToken {
  return typeof token === 'string' && (PERIOD_TOKENS as readonly string[]).includes(token);
}

/** `[Jan 1 00:00:00.000, Jan 1 00:00:00.000 of next year)` for `year`, in
 *  local time — the exclusive-end convention every other range in this
 *  module uses. */
function yearRange(year: number): PeriodRange {
  return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime() };
}

/** `[1st of `month` 00:00:00.000, 1st of the next month)` for `year`/`month`
 *  (0-based), in local time. */
function monthRange(year: number, month: number): PeriodRange {
  const start = new Date(year, month, 1).getTime();
  return { start, end: endOfPeriod(start, 'month') };
}

/**
 * Resolve a period spec to a concrete `[start, end)` epoch-ms range for the
 * given `now`. `last_*` tokens step back one calendar unit by taking the
 * current period's start and subtracting 1ms — landing inside the previous
 * period — then re-deriving that period's own full range, so a `last_month`
 * asked on the 1st of the month still resolves to the WHOLE previous month,
 * not a zero-length range. `all_time` has no calendar boundary: `start` is
 * epoch 0 and `end` is `now + 1` (exclusive-end convention, so a transaction
 * occurring at exactly `now` is still included). An explicit
 * `{ kind: 'year', year }` resolves to that whole calendar year; an explicit
 * `{ kind: 'month', year, month }` resolves to that whole calendar month.
 *
 * ── QA BLOCKER follow-up: never throw on a missing/unknown token ──────────
 * A BYOK tool call missing `period` entirely used to reach
 * `token.startsWith('last_')` with `token === undefined` and THROW — this
 * function is on the direct call path from `src/domain/queryTools.ts`'s
 * executors, which the BYOK tool loop (`src/features/ai/queryLoop.ts`) calls
 * with model-supplied params; "never throws (null -> fall through)" is that
 * loop's whole contract, so a throw here broke it. Anything that isn't
 * truly a member of `PERIOD_TOKENS` (or a well-formed `ExplicitYearPeriod`/
 * `ExplicitMonthPeriod`) falls back to `this_month` — the same "assume
 * this_month is a reasonable default" convention `queryToolSelection.ts`
 * already documents for its own missing-period case, so the fallback
 * behavior is consistent across every caller regardless of which engine
 * (FM, BYOK, floor) produced the call.
 */
export function resolvePeriodRange(spec: PeriodSpec, now: number): PeriodRange {
  if (isExplicitMonthPeriod(spec)) return monthRange(spec.year, spec.month);
  if (isExplicitYearPeriod(spec)) return yearRange(spec.year);
  if (!isKnownPeriodToken(spec)) return periodRange(now, 'month');
  if (spec === 'all_time') return { start: 0, end: now + 1 };

  const granularity = GRANULARITY_FOR[spec];
  if (spec.startsWith('last_')) {
    const previousInstant = startOfPeriod(now, granularity) - 1;
    return periodRange(previousInstant, granularity);
  }
  return periodRange(now, granularity);
}

// ─── Deterministic period extraction from the user's own words ───────────

/** Earliest year `resolvePeriodFromText` will ever accept as an explicit
 *  year — a bound sane enough that no real "which year did I spend X"
 *  question could legitimately need an earlier one, while keeping a random
 *  4-digit number ("flight AA1234", "PIN 1234"-shaped noise) from being
 *  misread as a year far more often. */
const EXPLICIT_YEAR_MIN = 1990;

/** Any 4-digit run, optionally preceded by a "FY"/"fy" fiscal-year prefix
 *  with no required space ("FY2025"). Matched globally so multiple
 *  candidates in the same text can each be checked/excluded independently. */
const YEAR_CANDIDATE_RE = /\b(?:fy\s?)?(\d{4})\b/g;

/** Amount-shaped context immediately AFTER a 4-digit run ("2026 dollars/
 *  bucks") — mirrors `queryIntent.ts`'s `hasStatedAmount` doctrine: a
 *  4-digit number is a YEAR unless the surrounding text says otherwise. */
const AMOUNT_TRAILING_WORD_RE = /^\s*(dollars?|bucks?|cents?|usd|sgd)\b/;

/** A currency symbol immediately BEFORE the 4-digit run ("$2026") — also an
 *  amount, not a year. */
const CURRENCY_LEADING_RE = /[$£€]\s*$/;

/** "Q1 2026"-style quarter references immediately BEFORE the 4-digit run —
 *  we don't model quarters at all (see the header's accepted-gap note), so
 *  a year attached to one must NOT silently widen into "the whole year"; the
 *  correct behavior is `null` (an honest "can't answer that precisely"),
 *  not a confidently-wrong figure for a different range than asked. */
const QUARTER_LEADING_RE = /\bq[1-4]\s*$/i;

/** A bare "since <year>" — an OPEN-ENDED range ("from 2020 onward") this
 *  module doesn't model (no `{kind:'since', year}` shape exists); treating
 *  it as a single-year period would confidently answer a DIFFERENT question
 *  than what was asked, so it's excluded rather than misread. Deliberately
 *  narrower than the `all_time` phrase set above ("since the start" IS
 *  matched there — "since <year>" is not, on purpose). */
const SINCE_LEADING_RE = /\bsince\s*$/;

/** A year immediately followed by a noun that makes it part of a DIFFERENT
 *  kind of reference, not a period — "flight to 2026 conference", "the 2026
 *  model", "book a 2026 trip" — a proper-noun/product-name collision QA
 *  found. Deliberately a small, conservative list (see the header's
 *  accepted-gap note): this can't catch every such collision, only the
 *  clearest ones, without a real NER model this app doesn't have. */
const NON_PERIOD_TRAILING_WORD_RE =
  /^\s*(conference|flight|trip|room|model|edition|version|meeting|summit|expo|festival)\b/;

/**
 * Find every explicit calendar year the text states (each checked
 * independently against the same exclusion rules "2026", "in 2025", "for
 * year 2026", "FY2025" all qualify; "$2026", "2026 dollars", "Q1 2026",
 * "since 2020", "flight to 2026 conference", and anything outside
 * `[EXPLICIT_YEAR_MIN, thisYear + 1]` do not). Returns them in the order
 * they appear — used both for the single-year case and for detecting a
 * multi-period COMPARISON (see `resolvePeriodFromText`).
 */
function findAllExplicitYears(t: string, now: number): number[] {
  const maxYear = new Date(now).getFullYear() + 1;
  const re = new RegExp(YEAR_CANDIDATE_RE.source, YEAR_CANDIDATE_RE.flags);
  const years: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const year = Number(m[1]);
    if (year < EXPLICIT_YEAR_MIN || year > maxYear) continue;

    const before = t.slice(0, m.index);
    if (CURRENCY_LEADING_RE.test(before)) continue;
    if (QUARTER_LEADING_RE.test(before)) continue;
    if (SINCE_LEADING_RE.test(before)) continue;

    const after = t.slice(m.index + m[0].length);
    if (AMOUNT_TRAILING_WORD_RE.test(after)) continue;
    if (NON_PERIOD_TRAILING_WORD_RE.test(after)) continue;

    years.push(year);
  }
  return years;
}

/** Full names and common abbreviations for every calendar month, 0-based
 *  (0 = January). Sorted longest-first when built into a regex alternation
 *  so e.g. "sept" is tried before "sep" (belt-and-braces — `\b` word
 *  boundaries already make the order not strictly matter). */
const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const MONTH_NAME_ALTERNATION = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** "March 2025", "Jan 2024" — a month name immediately followed by a 4-digit
 *  year. Checked FIRST (before the lead-word form) since it's unambiguous
 *  either way. */
const MONTH_WITH_YEAR_RE = new RegExp(`\\b(${MONTH_NAME_ALTERNATION})\\s+(\\d{4})\\b`);

/** "in March", "during March", "for March" — a month name with NO year,
 *  required to be led by one of these words specifically to keep a bare
 *  month name (especially "may", a common modal verb) from over-firing on
 *  ordinary prose that never meant a calendar month at all. */
const MONTH_LEAD_RE = new RegExp(`\\b(?:in|during|for)\\s+(${MONTH_NAME_ALTERNATION})\\b`);

/** For a bare month name with no year ("in March"): the most recent
 *  past-or-current occurrence relative to `now` — a bare month reference
 *  can never mean a FUTURE occurrence that hasn't happened yet this year. */
function mostRecentYearForMonth(month: number, now: number): number {
  const d = new Date(now);
  const thisYear = d.getFullYear();
  const thisMonth = d.getMonth();
  return month <= thisMonth ? thisYear : thisYear - 1;
}

/**
 * Find the single explicit calendar MONTH the text states, if any, along
 * with the exact substring matched (so the caller can strip it before
 * scanning for bare years — "March 2025"'s "2025" must not ALSO register as
 * an independent bare-year candidate). Returns `null` when no month
 * reference is found — see `MONTH_WITH_YEAR_RE`/`MONTH_LEAD_RE`'s headers
 * for exactly which shapes are (and are deliberately NOT) recognised.
 */
function findExplicitMonth(
  t: string,
  now: number
): { spec: ExplicitMonthPeriod; matchedText: string } | null {
  const withYear = MONTH_WITH_YEAR_RE.exec(t);
  if (withYear) {
    const month = MONTH_NAMES[withYear[1]!]!;
    const year = Number(withYear[2]);
    return { spec: { kind: 'month', year, month }, matchedText: withYear[0] };
  }
  const lead = MONTH_LEAD_RE.exec(t);
  if (lead) {
    const month = MONTH_NAMES[lead[1]!]!;
    return { spec: { kind: 'month', year: mostRecentYearForMonth(month, now), month }, matchedText: lead[0] };
  }
  return null;
}

/** A stable string key for de-duplicating/comparing `PeriodSpec` values —
 *  used only to detect "does the text mention MORE THAN ONE DISTINCT
 *  period" (see `resolvePeriodFromText`'s QA MAJOR 1 note). */
function periodKey(spec: PeriodSpec): string {
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'year') return `year:${spec.year}`;
  return `month:${spec.year}-${spec.month}`;
}

/**
 * Deterministically extract a period from the user's OWN words — see the
 * module header for the full doctrine this enforces. Collects EVERY
 * distinct period the text mentions:
 *  - relative phrases: "this/last month", "this/last week", "this/last
 *    year", "all time"/"ever"/"since the start"/"overall".
 *  - an explicit month ("March 2025", "in March", "Jan 2024").
 *  - an explicit year ("2026", "in 2025", "for year 2026", "FY2025"),
 *    guarded against amount-shaped numbers, quarter references, open-ended
 *    "since <year>" phrasing, proper-noun collisions, and an out-of-range
 *    year (see `findAllExplicitYears`'s exclusion regexes).
 *
 * Returns:
 *  - `null` when the text states NO period at all — the caller keeps
 *    whatever the model/floor already chose (or the documented `this_month`
 *    default), exactly as before this fix.
 *  - `null` when the text states TWO OR MORE DISTINCT periods — a
 *    comparison ("this month vs last month", "2025 vs 2026") is inherently
 *    multi-period, so the MODEL's own per-round composition (in the BYOK
 *    tool loop) is the correct signal for which period belongs to which
 *    round; deterministically picking one would collapse the comparison
 *    onto a single (wrong, doubled) answer. See the module header's QA
 *    MAJOR 1 note.
 *  - the single period, when EXACTLY ONE distinct one is stated.
 *
 * Accepted gaps (documented, not modeled — each returns `null` rather than a
 * confidently-wrong wider range): quarters ("Q1 2026"), open-ended ranges
 * ("since 2020"), explicit ranges ("between March and May"). A year directly
 * followed by a non-period noun ("flight to 2026 conference") is excluded on
 * a best-effort basis (`NON_PERIOD_TRAILING_WORD_RE`) — not exhaustive, but
 * covers the collision QA found without a real NER model.
 */
export function resolvePeriodFromText(text: string, now: number): PeriodSpec | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const candidates: PeriodSpec[] = [];

  if (/\blast month\b/.test(t)) candidates.push('last_month');
  if (/\bthis month\b/.test(t)) candidates.push('this_month');
  if (/\blast week\b/.test(t)) candidates.push('last_week');
  if (/\bthis week\b/.test(t)) candidates.push('this_week');
  if (/\blast year\b/.test(t)) candidates.push('last_year');
  if (/\bthis year\b/.test(t)) candidates.push('this_year');
  if (/\b(all time|ever|since the start|overall)\b/.test(t)) candidates.push('all_time');

  // Explicit month FIRST, so its (optional) year digits can be stripped
  // before the bare-year scan below — "March 2025" must not ALSO register
  // "2025" as a second, independent year candidate.
  let yearScanText = t;
  const month = findExplicitMonth(t, now);
  if (month) {
    candidates.push(month.spec);
    yearScanText = t.replace(month.matchedText, ' ');
  }

  for (const year of findAllExplicitYears(yearScanText, now)) {
    candidates.push({ kind: 'year', year });
  }

  if (candidates.length === 0) return null;

  const uniqueKeys = new Set(candidates.map(periodKey));
  if (uniqueKeys.size > 1) return null; // a comparison — let the model's per-round choice stand

  return candidates[0]!;
}
