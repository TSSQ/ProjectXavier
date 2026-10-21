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

/** An explicit calendar QUARTER ("q3", "Q1 2026", "this quarter") — only
 *  ever produced by `resolvePeriodFromText` (question eval D4). `quarter` is
 *  1-based (Q1 = Jan-Mar), as people write it. */
export interface ExplicitQuarterPeriod {
  kind: 'quarter';
  year: number;
  /** 1-based: 1 = January-March, 4 = October-December. */
  quarter: number;
}

/** What every tool executor's `period`/`asOf` param actually accepts — a
 *  model-facing token, OR a deterministically-extracted explicit year /
 *  month / quarter. */
export type PeriodSpec = PeriodToken | ExplicitYearPeriod | ExplicitMonthPeriod | ExplicitQuarterPeriod;

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

function isExplicitQuarterPeriod(spec: unknown): spec is ExplicitQuarterPeriod {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    (spec as { kind?: unknown }).kind === 'quarter' &&
    typeof (spec as { year?: unknown }).year === 'number' &&
    [1, 2, 3, 4].includes((spec as { quarter?: unknown }).quarter as number)
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
  if (isExplicitQuarterPeriod(spec)) {
    const first = monthRange(spec.year, 3 * (spec.quarter - 1));
    return { start: first.start, end: monthRange(spec.year, 3 * (spec.quarter - 1) + 2).end };
  }
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
 *  a year attached to a quarter must NOT also read as "the whole year".
 *  Since question eval D4 the quarter itself resolves (`findExplicitQuarter`,
 *  scanned first and stripped); this stays as a belt-and-braces guard. */
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

/** An apostrophe straight or curly (iOS Smart Punctuation types U+2019): a
 *  month abbreviation right before one is a name ("jan's bakery"). */
const APOS = `['’]`;
/** A month name followed by a day ("nov 5", "oct 31") is a DATE — never
 *  widened into the whole month. */
const NOT_A_DATE_OR_NAME = `(?!${APOS})(?!\\s*\\d)`;

/** "March 2025", "Jan 2024" — a month name immediately followed by a 4-digit
 *  year. Checked FIRST (before the other forms) since it's unambiguous. */
const MONTH_WITH_YEAR_RE = new RegExp(`\\b(${MONTH_NAME_ALTERNATION})\\s+(\\d{4})\\b`, 'g');

/** "in March", "during March", "for March" — a month name with NO year,
 *  required to be led by one of these words specifically to keep a bare
 *  month name (especially "may", a common modal verb) from over-firing on
 *  ordinary prose that never meant a calendar month at all. */
const MONTH_LEAD_RE = new RegExp(`\\b(?:in|during|for)\\s+(${MONTH_NAME_ALTERNATION})\\b${NOT_A_DATE_OR_NAME}`, 'g');

/** "last oct", "last july" (question eval D4) — the most recent occurrence
 *  BEFORE the current month: in October, "last oct" is a year back. */
const LAST_MONTH_NAME_RE = new RegExp(`\\blast\\s+(${MONTH_NAME_ALTERNATION})\\b${NOT_A_DATE_OR_NAME}`, 'g');

/** Month names that are too often something else to read without a lead
 *  word: "may" (a modal verb) and "apr" (a rate, in a finance app). */
const AMBIGUOUS_MONTH_WORDS = new Set(['may', 'apr']);
const CLEAR_MONTH_ALTERNATION = MONTH_NAME_ALTERNATION.split('|')
  .filter((m) => !AMBIGUOUS_MONTH_WORDS.has(m))
  .join('|');

/** A bare month right after a spend/total word, with no lead ("total oct",
 *  "how much sep") — question eval D4. Only in that slot: anywhere else a
 *  month word is far more often a name ("pay jan", "cafe june", "march
 *  madness"). */
const BARE_MONTH_RE = new RegExp(
  `\\b(?:total|spent|spend|spending|income|earned|earnings|expenses|how much)\\s+(${CLEAR_MONTH_ALTERNATION})\\b${NOT_A_DATE_OR_NAME}`,
  'g'
);

/** Any clear month word — what is left of these after the forms above is a
 *  month the text names that no form read (see `findExplicitMonths`). */
const MONTH_MENTION_RE = new RegExp(`\\b(?:${CLEAR_MONTH_ALTERNATION})\\b`, 'g');

/** For a bare month reference with no year ("in March"): the most recent
 *  past-or-current occurrence relative to `now` — a bare month reference
 *  can never mean a FUTURE occurrence that hasn't happened yet this year. */
function mostRecentYearForMonth(month: number, now: number): number {
  const d = new Date(now);
  const thisYear = d.getFullYear();
  const thisMonth = d.getMonth();
  return month <= thisMonth ? thisYear : thisYear - 1;
}

/** Every explicit month period read from `t`, and `t` with them removed.
 *  `ambiguous` is true when at least one month was read AND another month
 *  word was left unread ("last oct vs this oct"): a comparison, which must
 *  never collapse onto the one month that happened to match (QA MAJOR 1). */
function findExplicitMonths(
  t: string,
  now: number
): { specs: ExplicitMonthPeriod[]; ambiguous: boolean; rest: string } {
  const specs: ExplicitMonthPeriod[] = [];
  const d = new Date(now);
  let rest = t;
  const take = (re: RegExp, toSpec: (m: RegExpMatchArray) => ExplicitMonthPeriod) => {
    for (const m of rest.matchAll(re)) specs.push(toSpec(m));
    rest = rest.replace(re, ' ');
  };
  take(MONTH_WITH_YEAR_RE, (m) => ({ kind: 'month', year: Number(m[2]), month: MONTH_NAMES[m[1]!]! }));
  take(LAST_MONTH_NAME_RE, (m) => {
    const month = MONTH_NAMES[m[1]!]!;
    return { kind: 'month', year: month < d.getMonth() ? d.getFullYear() : d.getFullYear() - 1, month };
  });
  take(MONTH_LEAD_RE, (m) => {
    const month = MONTH_NAMES[m[1]!]!;
    return { kind: 'month', year: mostRecentYearForMonth(month, now), month };
  });
  take(BARE_MONTH_RE, (m) => {
    const month = MONTH_NAMES[m[1]!]!;
    return { kind: 'month', year: mostRecentYearForMonth(month, now), month };
  });
  const unread = rest.match(MONTH_MENTION_RE)?.length ?? 0;
  return { specs, ambiguous: specs.length > 0 && unread > 0, rest };
}

/** Quarters (question eval D4): "Q1 2026", "q1-2026", "q1 of 2025", "2025
 *  q1"; a bare "q3" only at the start or after a lead/spend word, and only
 *  when the next word (if any) is a spend/period word — "audi q3", "q4
 *  tickets" are names; "this/last quarter". Year bounded like an explicit
 *  year (`EXPLICIT_YEAR_MIN`, next year at most). */
const QUARTER_WITH_YEAR_RE = /\bq([1-4])\s*(?:-|\/|\bof\b)?\s*(\d{4})\b|\b(\d{4})\s*q([1-4])\b/g;
const BARE_QUARTER_RE =
  /(?:^|\b(?:in|for|during|total|spent|spend|spending|income|much|vs|versus|and|or|compare)\s+)q([1-4])\b(?=\s*$|\s*[?,.!]|\s+(?:spending|spend|spent|total|income|expenses|vs|versus|and|or|this|last)\b)/g;
const RELATIVE_QUARTER_RE = /\b(this|last)\s+quarter\b/g;

/** Every explicit quarter read from `t`, and `t` with them removed. A bare
 *  quarter takes "this year"/"last year" as its year when the text says one
 *  (`yearWord`, so the caller drops that relative-year candidate), else the
 *  most recent quarter that has started. */
function findExplicitQuarters(
  t: string,
  now: number
): { specs: ExplicitQuarterPeriod[]; rest: string; yearWord: boolean } {
  const d = new Date(now);
  const thisYear = d.getFullYear();
  const current = Math.floor(d.getMonth() / 3) + 1;
  const inRange = (y: number) => y >= EXPLICIT_YEAR_MIN && y <= thisYear + 1;
  const specs: ExplicitQuarterPeriod[] = [];
  let rest = t;
  for (const m of rest.matchAll(QUARTER_WITH_YEAR_RE)) {
    const quarter = Number(m[1] ?? m[4]);
    const year = Number(m[2] ?? m[3]);
    if (inRange(year)) specs.push({ kind: 'quarter', year, quarter });
  }
  rest = rest.replace(QUARTER_WITH_YEAR_RE, ' ');
  const yearWordMatch = /\b(this|last) year\b/.exec(rest);
  let yearWord = false;
  for (const m of rest.matchAll(BARE_QUARTER_RE)) {
    const quarter = Number(m[1]);
    let year = quarter <= current ? thisYear : thisYear - 1;
    if (yearWordMatch) {
      year = yearWordMatch[1] === 'this' ? thisYear : thisYear - 1;
      yearWord = true;
    }
    specs.push({ kind: 'quarter', year, quarter });
  }
  rest = rest.replace(BARE_QUARTER_RE, ' ');
  for (const m of rest.matchAll(RELATIVE_QUARTER_RE)) {
    if (m[1] === 'this') specs.push({ kind: 'quarter', year: thisYear, quarter: current });
    else specs.push({ kind: 'quarter', year: current === 1 ? thisYear - 1 : thisYear, quarter: current === 1 ? 4 : current - 1 });
  }
  rest = rest.replace(RELATIVE_QUARTER_RE, ' ');
  return { specs, rest, yearWord };
}

/** A stable string key for de-duplicating/comparing `PeriodSpec` values —
 *  used to detect "does the text mention MORE THAN ONE DISTINCT period"
 *  (see `resolvePeriodFromText`'s QA MAJOR 1 note). Exported so
 *  `src/domain/queryComparison.ts` can de-dup a BYOK tool loop's own
 *  per-call periods with the exact same equality rule, rather than
 *  re-deriving a second, driftable key function. */
export function periodKey(spec: PeriodSpec): string {
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'year') return `year:${spec.year}`;
  if (spec.kind === 'quarter') return `quarter:${spec.year}-${spec.quarter}`;
  return `month:${spec.year}-${spec.month}`;
}

/**
 * Deterministically extract a period from the user's OWN words — see the
 * module header for the full doctrine this enforces. Collects EVERY
 * distinct period the text mentions:
 *  - relative phrases: "this/last month", "this/last week", "this/last
 *    year", "all time"/"ever"/"since the start"/"overall".
 *  - an explicit month ("March 2025", "in March", "Jan 2024"; since question
 *    eval D4 also a bare "oct" when it is the only month named, and "last
 *    oct" = the one before the current month).
 *  - an explicit quarter ("q3", "Q1 2026", "this/last quarter") and "ytd" /
 *    "year to date" (= this_year) — question eval D4.
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
 * confidently-wrong wider range): open-ended ranges ("since 2020"), explicit
 * ranges ("between March and May"), "may" read bare (a modal verb far more
 * often — "in May" still resolves). A year directly
 * followed by a non-period noun ("flight to 2026 conference") is excluded on
 * a best-effort basis (`NON_PERIOD_TRAILING_WORD_RE`) — not exhaustive, but
 * covers the collision QA found without a real NER model.
 *
 * -- RULE: no gate change without a corpus case first --
 * Mirrors the intent gate's own rule (src/domain/queryIntent.ts's header):
 * this function's own device-bug history above (build 57, QA MAJOR 1, QA
 * MAJOR A) shows deterministic period extraction accretes edge cases exactly
 * like a hand-tuned regex gate. ANY change to what this function extracts --
 * a new relative phrase, a widened year/month pattern, a narrowed exclusion
 * -- must land with a new labeled line in `tests/query-corpus.jsonl` FIRST (a
 * case that fails on the OLD code, passes on the NEW code), not just a code
 * diff. `npm run eval:query` (evals-lite/query-report.mjs) is the
 * human-readable pass/fail surface for that corpus.
 */
export function resolvePeriodFromText(text: string, now: number): PeriodSpec | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const candidates: PeriodSpec[] = [];

  // Quarters first, so a quarter's year ("Q1 2026") is not ALSO a bare year
  // and "q1 this year" is one period, not two.
  const quarters = findExplicitQuarters(t, now);
  candidates.push(...quarters.specs);
  const scanText = quarters.rest;

  if (/\blast month\b/.test(scanText)) candidates.push('last_month');
  if (/\bthis month\b/.test(scanText)) candidates.push('this_month');
  if (/\blast week\b/.test(scanText)) candidates.push('last_week');
  if (/\bthis week\b/.test(scanText)) candidates.push('this_week');
  if (!quarters.yearWord && /\blast year\b/.test(scanText)) candidates.push('last_year');
  if (!quarters.yearWord && /\bthis year\b/.test(scanText)) candidates.push('this_year');
  if (/\b(all time|ever|since the start|overall)\b/.test(scanText)) candidates.push('all_time');
  // Question eval D4: "ytd" / "year to date" is this calendar year so far
  // (every aggregate already stops at today: future rows are not counted);
  // "ytd 2026" in 2026 is the same period, not a second one.
  const ytd = /\b(ytd|year to date)\b/.test(scanText);
  if (ytd) candidates.push('this_year');

  // Explicit months FIRST, so their (optional) year digits can be stripped
  // before the bare-year scan below — "March 2025" must not ALSO register
  // "2025" as a second, independent year candidate.
  const months = findExplicitMonths(scanText, now);
  if (months.ambiguous) return null; // a month the text names went unread: a comparison
  candidates.push(...months.specs);

  const thisYear = new Date(now).getFullYear();
  for (const year of findAllExplicitYears(months.rest, now)) {
    candidates.push(ytd && year === thisYear ? 'this_year' : { kind: 'year', year });
  }

  if (candidates.length === 0) return null;

  const uniqueKeys = new Set(candidates.map(periodKey));
  if (uniqueKeys.size > 1) return null; // a comparison — let the model's per-round choice stand

  return candidates[0]!;
}
