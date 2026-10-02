/**
 * Deterministic amount extraction for the on-device (Foundation Models) tier.
 *
 * The small model is unreliable at copying a number out of a sentence: it
 * invents one on texts with none, copies example numbers, and answers 0 for
 * "+3200 payday". Code can read an amount out of text reliably, so the FM path
 * (src/domain/fmParse.ts) asks this module first and only lets the model
 * choose among what it found:
 *   - one plausible candidate -> the amount comes from here, not the model;
 *   - several                 -> the model picks one from that closed set;
 *   - none                    -> the model's amount is trusted only when the
 *                                text supports it (fmParse.ts).
 *
 * "Plausible" means: a number that reads as money. Dates ("12/03", "June 24",
 * "on the 5th"), times ("5pm", "9:30"), percentages, card suffixes ("ending
 * 4008"), phone-like strings, ids ("#12", "room 204" when something else is
 * there) and counts ("2 friends", "3 days") are not candidates. Covered forms:
 * "$1,250", "1.250,50" and "12,50" (EU decimals), "1 250", "3k", "2 grand",
 * "15 bucks", "+3200", "S$5", "RM50", "USD 20", "500円", "50 cents", full-width
 * and Arabic-Indic digits, and spelled-out amounts that carry a currency word
 * ("twenty dollars", "a fiver"). A bare spelled-out number without one ("two
 * fifty") is NOT read here; such text has no candidate and goes to the model.
 *
 * Framework-free (no RN imports), output validated with zod.
 */
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from './currency';

export const amountCandidateSchema = z
  .object({
    /** Major currency units (dollars), always positive and finite. */
    value: z.number().positive().finite(),
    /** The text span the value was read from, as written. */
    text: z.string().min(1),
    /** UTF-16 offset of the span in the original text. */
    index: z.number().int().nonnegative(),
    /** Marked as money by a symbol, code, currency word or explicit sign. */
    anchored: z.boolean(),
  })
  .strict();

export type AmountCandidate = z.infer<typeof amountCandidateSchema>;

const candidatesSchema = z.array(amountCandidateSchema);

/** Only this much of a text is read. A transaction message is a line or two;
 *  several of the scans below are quadratic in the text length, and 50k
 *  characters took seconds. Past the cap nothing is read, so a long text
 *  yields fewer candidates, never a wrong one. */
export const MAX_TEXT_LENGTH = 2000;

// ─── normalisation ──────────────────────────────────────────────────────────

/** Full-width, Arabic-Indic, extended Arabic-Indic and Devanagari digits ->
 *  ASCII. Every one is a single UTF-16 unit, so offsets are preserved. */
function asciiDigits(text: string): string {
  return text.replace(/[０-９٠-٩۰-۹०-९]/g, (ch) => {
    const c = ch.charCodeAt(0);
    const base = c >= 0xff10 && c <= 0xff19 ? 0xff10 : c >= 0x06f0 && c <= 0x06f9 ? 0x06f0 : c >= 0x0966 ? 0x0966 : 0x0660;
    return String(c - base);
  });
}

// ─── spans that are never amounts ──────────────────────────────────────────

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)';
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
/** A month is not the start of "month day" when a day already sits before it
 *  ("12 sept 5": the date is "12 sept"; the 5 is left for the amount). */
const NO_DAY_BEFORE = `(?<!\\b${DAY}(?:${ORD})?\\s+(?:of\\s+)?)`;

const NEVER_AMOUNT: readonly RegExp[] = [
  // dates: 2026-07-03, 24/06/2026, 24.06.26, 1/7, and ratios/fractions (50/50)
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  /\b\d{1,4}\/\d{1,4}\b/g,
  // "June 24", "June 24th, 2026", "24 June", "the 5th of June", "June 2026"
  new RegExp(`${NO_DAY_BEFORE}\\b${MONTH}\\.?\\s+(?:the\\s+)?${DAY}(?:${ORD})?\\b(?:,?\\s+\\d{4}\\b)?`, 'gi'),
  new RegExp(`\\b${DAY}(?:${ORD})?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+\\d{4}\\b)?`, 'gi'),
  new RegExp(`${NO_DAY_BEFORE}\\b${MONTH}\\.?\\s+\\d{4}\\b`, 'gi'),
  // fiscal periods and store names that are made of numbers: "Q3 2026", "FY25", "7-11"
  /\b[QH][1-4]\s+(?:19|20)\d{2}\b/gi,
  /\b(?:19|20)\d{2}\s+[QH][1-4]\b/gi,
  /\bFY\s?\d{2,4}\b/gi,
  /\b7-(?:11|eleven)\b/gi,
  /\bon\s+the\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  // years after a preposition ("in 2024", "since 2019")
  /\b(?:in|since|year|during|until|before|by|of)\s+(?:19|20)\d{2}\b/gi,
  // times: 9:30, 5pm, 5 p.m., 6 o'clock
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\b\.?)?/gi,
  /\b\d{1,2}\s*[ap]\.?m\b\.?/gi,
  /\b\d{1,2}\s*o'?clock\b/gi,
  // percentages
  /\d+(?:[.,]\d+)?\s*(?:%|percent\b|pct\b|per\s*cent\b)/gi,
  // card / account suffixes: "ending 4008", "card 4008", "visa -4008", "****4008", "chase-4008"
  /\b(?:ending(?:\s+in)?|card|acct|account|a\/c)\s*(?:no\.?|number|#)?\s*[-:#*•x]*\s*\d{4}\b/gi,
  /\b(?:visa|mastercard|amex|debit|credit|card)\b[^\d\n]{0,8}[-−*•x]+\s?\d{4}\b/gi,
  /(?:[*•]+|\bx{2,}|\.{2,})\s?\d{4}\b/gi,
  /(?<=[A-Za-z])-\d{4}\b/g,
  // phone-like: 555-123-4567, (555) 123-4567, 9123 4567, +65 9123 4567
  /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]\d{2,4}){2,}/g,
  /\(\d{3}\)\s?\d{3}[\s-]\d{4}/g,
  /\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/g,
  /\b\d{3}-\d{4}\b/g,
  /\b\d{4}[\s-]\d{4}\b/g,
  // long digit runs with no separator are ids, not money
  /\b\d{9,}\b/g,
  // identifiers and multipliers: "#12", "no. 5", "x2", "x 2"
  /#\s*\d+/g,
  /\bno\.\s*\d+/gi,
  /(?<![A-Za-z0-9])[x×]\s?\d+/gi,
];

function maskedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of NEVER_AMOUNT) {
    for (const m of text.matchAll(re)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return spans;
}

// ─── number tokens ──────────────────────────────────────────────────────────

const CODES = [...SUPPORTED_CURRENCIES].join('|');
const PREFIX = `(?:(?:US|S|A|C|HK|NT|NZ|R)?\\$|[€£¥₹₩฿₱₫₪₽₺]|RM|Rp|Rs|${CODES})`;
const NUM =
  '\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2})?(?!\\d)|' + // 1 250 / 1 250,50
  '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|' + // 1,250.50
  '\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|' + // 1.250,50
  '\\d+(?:[.,]\\d+)?|' + // 12.50 / 12,50 / 12
  '\\.\\d+'; // .5 / $.99

/** [1] leading sign [2] prefix [3] sign after prefix [4] number [5] k (x1000)
 *  or c / the cent sign (cents, only glued to the number). Case
 *  sensitive on purpose: "SGD"/"RM" are codes, "sgd"/"rm 204" are not. */
const TOKEN_RE = new RegExp(
  `(?<![A-Za-z0-9])([+\\-−])?(${PREFIX})?[ ]?([+\\-−])?(${NUM})([kKc¢])?(?![A-Za-z0-9])`,
  'g'
);

/** Words that follow a number and say what it is. */
const SUFFIX_RE = new RegExp(
  '^\\s?(?:' +
    '(dollars?|bucks?|euros?|pounds?|quid|yen|yuan|rmb|rupees?|baht|ringgit|dirhams?|[$€£¥]|円|元|원)' +
    '|(cents?|¢)' +
    '|(hundred|thousand|grand|million)' +
    ')(?![A-Za-z])',
  'i'
);
const CODE_SUFFIX_RE = new RegExp(`^\\s?(${CODES})(?![A-Za-z])`);
const LOWER_CODE_SUFFIX_RE = new RegExp(`^\\s?(${CODES.toLowerCase()})(?![A-Za-z])`);
/** Lowercase codes that are ordinary English words, so only the uppercase form counts. */
const WORD_LIKE_CODES = new Set(['pen', 'cop', 'try', 'ron']);

const MULTIPLIER: Record<string, number> = { hundred: 100, thousand: 1000, grand: 1000, million: 1_000_000 };

/** "5.000" / "1.250": one dot and exactly three digits is a thousands separator
 *  in much of Europe and a (3-decimal) fraction elsewhere. */
const AMBIGUOUS_DOT_RE = /^[1-9]\d{0,2}\.\d{3}$/;

function parseNumber(raw: string, euroHint: boolean): number {
  const s = raw.replace(/[ \u00a0\u202f]/g, '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3}){2,}(?:,\d+)?$/.test(s) || /^\d{1,3}\.\d{3},\d+$/.test(s)) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  // "1.250": thousands only when the text is clearly European; else a decimal.
  if (AMBIGUOUS_DOT_RE.test(s) && euroHint) return Number(s.replace('.', ''));
  return Number(s.replace(',', '.'));
}

// ─── things that read as a count, an id or a label, not money ──────────────

/** The word right before an integer that names a place, a number plate or an id. */
const LABEL_BEFORE_RE =
  /(?:^|[^A-Za-z])(?:room|rm|table|apt|apartment|unit|suite|flight|bus|route|line|gate|seat|floor|level|lot|block|blk|order|invoice|ref|id|pin|code|otp|train|platform|bay|locker|booth|channel|chapter|page|version|no|number|(?:table|party|group|reservation|booking)\s+(?:for|of))\s*$/i;

/** The word right after an integer that makes it a count of people, time or
 *  distance: never money, so such an integer is not a candidate at all. */
const COUNT_AFTER_RE =
  /^\s?(?:people|persons?|pax|guys|friends?|kids|adults|children|guests|colleagues|coworkers|mates|of us|times|night|nights|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|seconds?|secs?|km|kms|miles?|metres?|meters?|kg|kgs|lbs?|oz|litres?|liters?|stops|floors|levels|points|pts|stars)(?![A-Za-z])/i;

// ─── spelled-out amounts (only with a currency word) ───────────────────────

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(TENS), 'hundred', 'thousand', 'and', 'a'].join('|')})`;
const CURRENCY_WORD = '(?:dollars?|bucks?|euros?|pounds?|quid|cents?)';
const WORD_AMOUNT_RE = new RegExp(
  `(?<![A-Za-z])((?:${NUMBER_WORD}[\\s-]+)*${NUMBER_WORD})\\s+(${CURRENCY_WORD}|grand)(?![A-Za-z])`,
  'gi'
);
const SLANG_RE = /(?<![A-Za-z])(?:(?:a|one)\s+)?(fiver|tenner)(?![A-Za-z])/gi;

/** "twenty five" -> 25, "one hundred and fifty" -> 150, "a" -> 1; null if it is not a number. */
function wordsToNumber(phrase: string): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of phrase.toLowerCase().split(/[\s-]+/)) {
    if (w === 'and') continue;
    if (w === 'a') { current += 1; seen = true; continue; }
    if (w in UNITS) { current += UNITS[w]!; seen = true; }
    else if (w in TENS) { current += TENS[w]!; seen = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

function wordCandidates(text: string): AmountCandidate[] {
  const out: AmountCandidate[] = [];
  for (const m of text.matchAll(WORD_AMOUNT_RE)) {
    const n = wordsToNumber(m[1]!);
    if (n == null || n <= 0) continue;
    const unit = m[2]!.toLowerCase();
    const value = unit === 'grand' ? n * 1000 : /^cents?$/.test(unit) ? n / 100 : n;
    out.push({ value, text: m[0], index: m.index ?? 0, anchored: true });
  }
  for (const m of text.matchAll(SLANG_RE)) {
    out.push({ value: m[1]!.toLowerCase() === 'fiver' ? 5 : 10, text: m[0], index: m.index ?? 0, anchored: true });
  }
  return out;
}

// ─── extraction ─────────────────────────────────────────────────────────────

function overlaps(spans: Array<[number, number]>, start: number, end: number): boolean {
  return spans.some(([s, e]) => start < e && end > s);
}

type Found = AmountCandidate & {
  soft: boolean;
  /** Reads as a count of cents / as a whole currency amount, for "20 dollars and 50 cents". */
  unit: 'cents' | 'major' | null;
  /** Offset just past the span. */
  end: number;
  /** The other reading of an ambiguous "5.000" (thousands), when there is one. */
  alt: number | null;
};

const CENTS_JOINER_RE = /^\s*(?:and\s+|&\s*|,\s*)?$/i;

function digitCandidates(text: string, spans: Array<[number, number]>): Found[] {
  const euroHint = /€|\bEUR\b|\d,\d{2}(?!\d)/.test(text);
  const out: Found[] = [];
  // A currency code after a number belongs to that number ("50 USD 2 days ago"):
  // it must not become the prefix of the next one.
  let consumedUntil = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const whole = m[0];
    const number = m[4]!;
    const prefix = (m.index ?? 0) < consumedUntil ? undefined : m[2];
    const end = (m.index ?? 0) + whole.length;
    const start = end - (m[5] ? 1 : 0) - number.length;
    if (overlaps(spans, start, end)) continue;

    let value = parseNumber(number, euroHint);
    let unit: Found['unit'] = prefix ? 'major' : null;
    if (m[5] === 'k' || m[5] === 'K') value *= 1000;
    else if (m[5]) {
      value /= 100;
      unit = 'cents';
    }
    const rest = text.slice(end);
    let anchored =
      prefix != null || m[5] === 'c' || m[5] === '¢' || (m[1] != null && !/\s/.test(whole.slice(0, 2))) || m[3] != null;
    let spanEnd = end;
    let multiplied = m[5] != null;

    const suffix = SUFFIX_RE.exec(rest);
    if (suffix) {
      spanEnd = end + suffix[0].length;
      if (suffix[3]) {
        value *= MULTIPLIER[suffix[3].toLowerCase()]!;
        multiplied = true;
      } else {
        if (suffix[2]) {
          value /= 100;
          unit = 'cents';
          multiplied = true;
        } else unit = 'major';
        anchored = true;
      }
    } else {
      const code = CODE_SUFFIX_RE.exec(rest) ?? (() => {
        const lower = LOWER_CODE_SUFFIX_RE.exec(rest);
        return lower && !WORD_LIKE_CODES.has(lower[1]!) ? lower : null;
      })();
      if (code) {
        anchored = true;
        unit = 'major';
        spanEnd = end + code[0].length;
      }
    }
    consumedUntil = Math.max(consumedUntil, spanEnd);

    if (!Number.isFinite(value) || value <= 0) continue;
    const isBareInteger = !anchored && /^\d+$/.test(number) && !m[5];
    if (isBareInteger && COUNT_AFTER_RE.test(rest)) continue;
    const soft = isBareInteger && LABEL_BEFORE_RE.test(text.slice(0, start));
    const startOfSpan = prefix ? (m.index ?? 0) : start;
    const alt = !multiplied && !euroHint && AMBIGUOUS_DOT_RE.test(number) ? Number(number.replace('.', '')) : null;
    out.push({ value, text: text.slice(startOfSpan, spanEnd), index: startOfSpan, anchored, soft, unit, end: spanEnd, alt });
  }
  return mergeCents(text, out);
}

/** "20 dollars and 50 cents" is one amount, 20.50, not a choice between two. */
function mergeCents(text: string, found: Found[]): Found[] {
  const merged: Found[] = [];
  for (const c of found) {
    const prev = merged[merged.length - 1];
    if (
      prev && prev.unit === 'major' && c.unit === 'cents' && c.value < 1 &&
      CENTS_JOINER_RE.test(text.slice(prev.end, c.index))
    ) {
      merged[merged.length - 1] = {
        ...prev,
        value: prev.value + c.value,
        text: text.slice(prev.index, c.end),
        end: c.end,
        unit: null,
        alt: null,
      };
    } else merged.push(c);
  }
  return merged;
}

/**
 * The amounts `text` plausibly states, in reading order, one per distinct
 * value, in MAJOR units. Empty when it reads as no amount.
 *
 * An ambiguous single-dot, three-digit group ("5.000", "rent 1.250") has no
 * decimal or thousands context to settle it, so both readings are returned and
 * the model chooses from the closed set (the confirm card still shows the
 * result). Falling back to the model's free number would instead drop the
 * amount, since the text carries no spelled-out number.
 *
 * Narrowing: an integer that is followed by a count word ("2 friends", "3
 * days") is never a candidate; one that follows a label word ("room 204") is
 * dropped when another candidate exists; and when any candidate is marked as
 * money (symbol, code, currency word, explicit sign) only those stay.
 */
export function extractAmountCandidates(text: string): AmountCandidate[] {
  const t = asciiDigits(text.slice(0, MAX_TEXT_LENGTH));
  const spans = maskedSpans(t);
  const digits = digitCandidates(t, spans).flatMap((c) =>
    // An ambiguous "5.000" offers both readings; the closed choice keeps the right one in reach.
    c.alt == null ? [c] : [c, { ...c, value: c.alt }]
  );
  const all = [...digits, ...wordCandidates(t).map((c) => ({ ...c, soft: false }))].sort(
    (a, b) => a.index - b.index
  );

  const firm = all.filter((c) => !c.soft);
  const pool = firm.length > 0 ? firm : all;
  const anchored = pool.filter((c) => c.anchored);
  const chosen = anchored.length > 0 ? anchored : pool;

  const seen = new Set<number>();
  const unique: AmountCandidate[] = [];
  for (const c of chosen) {
    const value = Math.round(c.value * 1e6) / 1e6;
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push({ value, text: c.text, index: c.index, anchored: c.anchored });
  }
  return candidatesSchema.parse(unique);
}

/** How a candidate value is shown to the model and matched back: its plain
 *  decimal form ("1250", "12.5"). */
export function candidateLabel(value: number): string {
  return String(value);
}
