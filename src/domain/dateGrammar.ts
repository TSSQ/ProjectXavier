/**
 * The one date grammar. Both questions the app asks about printed dates are
 * answered from here:
 *
 *   - "is this LINE a date header?"      — isDateOnlyLine (statementLayout.ts)
 *   - "which date does this TEXT mean?"  — findDates, scored and resolved by
 *                                          resolveAbsoluteDate (deviceParsePrompt.ts)
 *
 * They used to be two independent regex sets with their own month lists, and
 * they drifted: a format could be read by one and not the other. Apple's
 * "23 Sept 2026 • Xavier" header was a date to the resolver but not to the
 * line classifier, which collapsed two purchases into one. Measured against
 * 47 realistic formats, 21 failed somewhere and the two disagreed on 13 —
 * including "16-SEP-2026" failing in both, and "2025-09-16" silently
 * resolving to 2026. The format inventory lives in
 * tests/__features__/date-grammar.feature; add a row there, not a regex
 * somewhere else.
 *
 * Pure and framework-free — no Date, no clock. Resolving a match to an
 * instant (inferring a missing year, rejecting 31 Feb) stays with the callers,
 * which know what "now" is.
 */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Every accepted spelling, abbreviated or full ("Sep", "Sept", "September").
 *  Callers match case-insensitively and allow a trailing "." ("Sep."). */
const MONTH_ALT =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
  'sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

export type DateForm = 'iso' | 'numeric' | 'day-month' | 'month-day';

/** One date-shaped span of text, not yet anchored to a year. */
export interface DateMatch {
  day: number;
  /** 0-11. */
  month0: number;
  /** Only when printed. Two-digit years are already mapped to 20xx. */
  year?: number;
  /** [index, end) into the text that was searched. */
  index: number;
  end: number;
  form: DateForm;
}

/** "2026-09-16", "2026/9/16". Year first, so never ambiguous. */
const ISO_RE = /(?<!\d)(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?!\d)/g;

/** "16/09/2026", "16-9-26", "16.09.2026", "16/09" — day-first, swapped only
 *  when that is impossible ("09/16/2026"). The separator must repeat before a
 *  year. A DOT is accepted only with a year: "12.05" is a price, not 12 May.
 *  The lookbehind keeps it out of longer digit runs ("55604-0", ISO dates). */
const NUMERIC_RE = /(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?!\d|[/.-]\d)/g;

/** "16 Sep 2026", "16th of September", "16 Sep, 2026", "16 Sep. 2026",
 *  "16-SEP-2026", "16-Sep-26", "16Sep2026", "16SEP26".
 *
 *  A two-digit year is honoured ONLY in the dashed and compact forms, where
 *  the separator (or its absence) makes it unmistakably part of the date.
 *  After a space it is not: "spent 10 June 24" means 24 June, not 10 June
 *  2024 — the month-day reading below wins that overlap. */
const DAY_MONTH_RE = new RegExp(
  `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?(\\s+of\\s+|\\s*-\\s*|\\s+|)(${MONTH_ALT})\\.?` +
    `(?:,?\\s+(\\d{4})|(?:\\s*-\\s*|)(\\d{4}|\\d{2}))?(?![a-z\\d])`,
  'gi'
);

/** "Sep 16, 2026", "September 16 2026", "Sep. 16", "Sept 16th". */
const MONTH_DAY_RE = new RegExp(
  `(?<![a-z])(${MONTH_ALT})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?(?![a-z\\d])`,
  'gi'
);

function fullYear(y: string | undefined): number | undefined {
  if (y == null) return undefined;
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

function plausible(day: number, month0: number): boolean {
  return month0 >= 0 && month0 <= 11 && day >= 1 && day <= 31;
}

/** When two readings overlap, which is kept. Longer spans win (they explain
 *  more of the text); at equal length, month-day beats day-month so
 *  "10 June 24" stays 24 June, which the resolver has always done. */
const FORM_RANK: Record<DateForm, number> = { iso: 0, numeric: 1, 'month-day': 2, 'day-month': 3 };

/** Every date in `text`, left to right, with overlapping readings resolved to
 *  one. Says nothing about which is THE date — that is a caller's call (see
 *  resolveAbsoluteDate's scoring). */
export function findDates(text: string): DateMatch[] {
  const found: DateMatch[] = [];
  for (const m of text.matchAll(ISO_RE)) {
    const month0 = Number(m[3]) - 1;
    const day = Number(m[4]);
    if (plausible(day, month0)) {
      found.push({ day, month0, year: Number(m[1]), index: m.index!, end: m.index! + m[0].length, form: 'iso' });
    }
  }
  for (const m of text.matchAll(NUMERIC_RE)) {
    if (m[2] === '.' && m[4] == null) continue;
    let day = Number(m[1]);
    let month = Number(m[3]);
    if (day <= 12 && month > 12) [day, month] = [month, day]; // written MM/DD
    if (plausible(day, month - 1)) {
      found.push({ day, month0: month - 1, year: fullYear(m[4]), index: m.index!, end: m.index! + m[0].length, form: 'numeric' });
    }
  }
  for (const m of text.matchAll(DAY_MONTH_RE)) {
    const day = Number(m[1]);
    const month0 = MONTH_INDEX[m[3]!.slice(0, 3).toLowerCase()]!;
    if (plausible(day, month0)) {
      found.push({ day, month0, year: fullYear(m[4] ?? m[5]), index: m.index!, end: m.index! + m[0].length, form: 'day-month' });
    }
  }
  for (const m of text.matchAll(MONTH_DAY_RE)) {
    const month0 = MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]!;
    const day = Number(m[2]);
    if (plausible(day, month0)) {
      found.push({ day, month0, year: fullYear(m[3]), index: m.index!, end: m.index! + m[0].length, form: 'month-day' });
    }
  }

  const byPreference = [...found].sort(
    (a, b) => (b.end - b.index) - (a.end - a.index) || FORM_RANK[a.form] - FORM_RANK[b.form] || a.index - b.index
  );
  const kept: DateMatch[] = [];
  for (const c of byPreference) {
    if (kept.every((k) => c.end <= k.index || c.index >= k.end)) kept.push(c);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/** A leading weekday ("Wed, ", "Wednesday ", "Wed. "). */
const WEEKDAY_PREFIX_RE = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

/** A trailing " • <anything>" — Apple's purchase history prints
 *  "23 Sept 2026 • Xavier" (the family member who bought it). Only bullet-ish
 *  separators: a hyphen or en dash would turn the range "25 Aug - 30 Aug"
 *  into a single date. */
const TRAILING_SEPARATOR_SUFFIX_RE = /\s*[•·|]\s*\S.*$/;

/** A trailing clock time: " 13:12:18", ", 1:12 PM", " at 9:05am", ISO's
 *  "T13:12:18Z", and a zone after it (" 13:12 SGT", " GMT+8", "+08:00"). Tills and bank
 *  apps print the time beside the date. The zone is only ever accepted
 *  directly after a time, so a bare trailing word is never mistaken for one. */
const TRAILING_TIME_RE =
  /(?:[,\s]+(?:at\s+)?|T)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]\.?m\.?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}|[A-Z]{2,4}(?:[+-]\d{1,2}(?::?\d{2})?)?\b))?\s*$/i;

/** A weekday in brackets AFTER the date — "24/09/2026 (Thu)", a common till
 *  format. Only a weekday inside the brackets is stripped. */
const TRAILING_WEEKDAY_RE = /\s*\((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\)\s*$/i;

/** "Today" / "Yesterday", with anything after ("Today • 2 purchases"). */
const RELATIVE_HEADER_RE = /^(today|yesterday)\b/i;

/**
 * True when `text` is a date header and nothing else — once its decorations
 * are removed (a leading weekday, a trailing "• name", a trailing time), the
 * rest must be exactly ONE date spanning all of it.
 *
 * Exactly one, spanning everything: that is what keeps ordinary lines out.
 * "Order 12", "Table 5", "2 Pending" contain no date; "25 Aug - 30 Aug"
 * contains two; "Paid 16 Sep" has a date that doesn't span the line.
 */
export function isDateOnlyLine(text: string): boolean {
  const trimmed = text.trim();
  if (RELATIVE_HEADER_RE.test(trimmed)) return true;
  const core = trimmed
    .replace(WEEKDAY_PREFIX_RE, '')
    .replace(TRAILING_SEPARATOR_SUFFIX_RE, '')
    .replace(TRAILING_WEEKDAY_RE, '')
    .replace(TRAILING_TIME_RE, '')
    .trim()
    .replace(/[.,]$/, '');
  if (!core) return false;
  const dates = findDates(core);
  return dates.length === 1 && dates[0]!.index === 0 && dates[0]!.end === core.length;
}
