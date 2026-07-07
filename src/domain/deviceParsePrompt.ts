/**
 * On-device (Apple Foundation Models) parse tier — pure, framework-free bits.
 *
 * Mirrored the (now-unused) cloud proxy's parse contract
 * (supabase/functions/parse/index.ts, kept in the repo for a possible future
 * opt-in sync) so the same interpret()/draft-card/save path
 * (src/domain/assistant.ts) can consume either engine's output unchanged. The
 * native binding
 * (@react-native-ai/apple, driven through the Vercel AI SDK's generateObject)
 * is only touched from the feature layer (src/features/ai/deviceParse.ts) —
 * this module has zero RN/Expo imports so it stays testable in the plain-node
 * BDD suite.
 *
 * Two binding/model constraints shape this schema:
 *
 * 1. The binding's native JSON-schema converter (AppleLLMImpl.swift
 *    parseDynamicSchema) reads `type` as a single string, so a `.nullable()`
 *    union (`["string","null"]`/anyOf) is rejected as "Unsupported schema
 *    type". Null cannot be expressed; the only lever is required vs optional
 *    (which maps to DynamicGenerationSchema's `isOptional`).
 * 2. The on-device iPhone model (smaller than the macOS simulator's) treats
 *    `.optional()` fields as licence to skip: on device it omitted amount,
 *    payee, currency and type even when they were present in the text, filling
 *    only category. So the fields we actually expect to recover — amount,
 *    type, category, payee — are REQUIRED here, forcing the model to produce a
 *    value it would otherwise omit. Since it then cannot signal "unknown" via
 *    omission, those fields use a documented sentinel (0 for amount, "" for
 *    text) that normalization maps back to null. Genuinely-often-absent fields
 *    (currency, note, occurredOn) stay optional. The date is asked for as a
 *    YYYY-MM-DD string (occurredOn), not epoch ms — the small model can't do
 *    date arithmetic, so normalization converts the string to epoch instead.
 *
 * The feature layer still treats the model's output as untrusted and
 * re-validates the normalized result against `aiParsedExpenseSchema`
 * (src/lib/validation) before use (guardrail #6).
 */
import { z } from 'zod';
import { TransactionType, Category, Payee, Account } from './types';
import { boundedNamePattern } from './textMatch';

// ─── guided-generation schema ───────────────────────────────────────────────

/** Schema handed to `generateObject` as the Foundation Models guided-
 *  generation contract. Field names/intent mirror `aiParsedExpenseSchema`
 *  (src/lib/validation) and the (now-unused) cloud EXPENSE_SCHEMA it was
 *  originally modelled on (supabase/functions/parse/index.ts). Deliberately
 *  looser than `aiParsedExpenseSchema` (no positive/length constraints) so a
 *  marginal model answer still comes back and normalization decides what
 *  survives. */
export const deviceParseSchema = z.object({
  amount: z
    .number()
    .describe(
      'The transaction amount as a decimal in the main currency unit, exactly ' +
        'as the user stated it — "twenty" or "$20" is 20, "twelve fifty" or ' +
        '"$12.50" is 12.5. Do NOT convert to cents. Use 0 ONLY if the text ' +
        'truly states no amount.'
    ),
  currency: z
    .string()
    .optional()
    .describe('ISO 4217 code, e.g. "USD". Omit if unknown.'),
  type: z
    .enum(['expense', 'income', 'transfer'])
    .describe(
      'The kind of transaction. Money going out (spent, bought, paid) is ' +
        '"expense"; money coming in is "income"; moving between your own ' +
        'accounts is "transfer". Default to "expense" if unsure.'
    ),
  category: z
    .string()
    .describe(
      'A concise spending category that fits the expense (e.g. "Groceries", ' +
        '"Dining", "Transport"): prefer one of the known categories when it ' +
        'fits, otherwise propose a new concise name. Always provide one.'
    ),
  payee: z
    .string()
    .describe(
      "The merchant, business, place, or person the money went to, copied " +
        'from the user\'s own words (e.g. "Starbucks", "the coffee shop", ' +
        '"John"). NEVER answer with a known payee whose name the user did ' +
        'not write — only reuse a known payee when its name appears in the ' +
        'text. A place phrase like "the coffee shop" or "the market" IS the ' +
        'payee — use it as written, but never include the amount or any ' +
        'numbers in the payee. Use an empty string "" ONLY when no merchant, ' +
        'place, or person appears in the text — a bare product word like ' +
        '"pizza" or "coffee" alone is NOT a payee.'
    ),
  account: z
    .string()
    .describe(
      'The account or card the user said they paid with (e.g. "Amex", ' +
        '"Checking"); prefer an exact match to a known account, otherwise use ' +
        'the name as written. Use an empty string "" when the user did NOT ' +
        'name a specific account or card.'
    ),
  note: z
    .string()
    .optional()
    .describe('Any additional free-text note. Omit if none.'),
  occurredOn: z
    .string()
    .optional()
    .describe(
      'The calendar date the transaction happened, as YYYY-MM-DD. Use the ' +
        'provided "today" date when no date is given and the "yesterday" date ' +
        'for "yesterday". Do NOT return a timestamp or epoch number. Omit only ' +
        'if a date genuinely cannot be determined.'
    ),
  confidence: z
    .number()
    .describe('Your overall confidence in the parse, from 0 to 1.'),
});

/** What the model returns after `generateObject` has validated it against
 *  `deviceParseSchema` — still pre-normalization, so string fields may be
 *  empty/padded and numbers out of the app's accepted ranges. */
export type DeviceParseModelOutput = z.infer<typeof deviceParseSchema>;

const KNOWN_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];

// ─── prompt construction ────────────────────────────────────────────────────

export interface DeviceParseContext {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** Injected clock — never call Date.now() inside this module. */
  now: number;
}

/** System instructions for the on-device session. Mirrored the (now-unused)
 *  cloud proxy's SYSTEM prompt intent (supabase/functions/parse/index.ts). */
export function buildDeviceParseInstructions(): string {
  return [
    'You convert a short expense description into structured data.',
    'You MUST fill in "amount", "type", "category", "payee" and "account" on',
    'every response — never leave them out.',
    'Report "amount" as a decimal in the main currency unit, exactly as the',
    'user stated it ("$20" -> 20, "$12.50" -> 12.5) — do NOT convert to cents;',
    'use 0 only if the text truly states no amount.',
    'Set "type" to "expense" for money going out (spent, bought, paid),',
    '"income" for money coming in, or "transfer" between your own accounts —',
    'default to "expense" if unsure.',
    'Set "category" to a concise spending category that fits the expense',
    '(e.g. "Groceries", "Dining", "Transport"): prefer one of the user’s known',
    'categories when it fits, otherwise propose a new concise name.',
    'Set "payee" to the merchant, business, place, or person the money went to,',
    "copied from the user's own words. NEVER answer with a known payee whose name",
    'the user did not write. A place phrase like "the coffee shop" or "the',
    'market" IS the payee — use it as written, but never include the amount or',
    'any numbers in the payee. Use an empty string "" only when no merchant,',
    'place, or person appears in the text — a bare product word like "pizza" or',
    '"coffee" alone is NOT a payee.',
    'Set "account" to the account or card the user said they paid with (e.g.',
    '"Amex", "Checking"); match a known account when the user names one. Use an',
    'empty string "" for account when the user did NOT name a specific account.',
    'Set "occurredOn" to the calendar date as YYYY-MM-DD — use the provided',
    '"today" date when no date is given and the "yesterday" date for "yesterday".',
    'Never return a timestamp or number for the date.',
    'For "currency", omit the field rather than guessing when you cannot',
    'determine it with reasonable confidence.',
    'Set "confidence" to your overall confidence in the parse from 0 to 1.',
  ].join(' ');
}

/** User-turn prompt: grounds the model in the user's existing entities (so it
 *  maps to them instead of inventing duplicates) plus the device's current
 *  time, then the expense text itself. Mirrored the (now-unused) cloud
 *  proxy's `content` assembly (supabase/functions/parse/index.ts). */
export function buildDeviceParsePrompt(text: string, ctx: DeviceParseContext): string {
  // Local calendar dates (not UTC) so "today"/"yesterday" match the user's day.
  // Giving the model the resolved dates removes any epoch/date arithmetic — the
  // small on-device model just picks the right string (see the amount fix for
  // the same "don't make it compute" reasoning).
  const today = toLocalDateString(ctx.now);
  const yesterday = toLocalDateString(ctx.now - 86_400_000);
  const hints: string[] = [];
  if (ctx.categories.length) {
    hints.push(
      `Known categories: ${ctx.categories.map((c) => c.name).join(', ')}. ` +
        'Use one of these for "category" if it fits; otherwise propose a concise new name.'
    );
  }
  if (ctx.payees.length) {
    hints.push(
      `Known payees: ${ctx.payees.map((p) => p.name).join(', ')}. ` +
        "Reuse one ONLY if its name appears in the user's text."
    );
  }
  if (ctx.accounts.length) {
    hints.push(
      `Known accounts: ${ctx.accounts.map((a) => a.name).join(', ')}. ` +
        'If the user names which account or card they used, set "account" to the ' +
        'matching name; otherwise "".'
    );
  }
  return (
    `Today is ${today}. Yesterday was ${yesterday}. Set "occurredOn" to the ` +
    `calendar date (YYYY-MM-DD) the expense happened — use ${today} when the ` +
    `user gives no date, and ${yesterday} for "yesterday". ` +
    (hints.length ? hints.join(' ') + ' ' : '') +
    `Expense: ${text}`
  );
}

/** Format an epoch-ms instant as a LOCAL YYYY-MM-DD (device timezone), so the
 *  "today"/"yesterday" dates handed to the model match the user's calendar day
 *  rather than a UTC day that can be off by one near midnight. */
function toLocalDateString(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── usefulness gate ────────────────────────────────────────────────────────

/** Whether an on-device parse is worth surfacing rather than falling through
 *  to the heuristic tier: it must carry a positive amount. A schema-valid but
 *  empty parse (amount omitted -> null) is worse than the heuristic, which
 *  tries harder to extract something from the text. Single source of truth for
 *  both the assistant screen's fallback gate (app/(tabs)/index.tsx) and the
 *  cold-start retry in src/features/ai/deviceParse.ts. */
export function isUsefulDeviceParse(
  p: { amount: number | null } | null | undefined
): boolean {
  return p != null && p.amount != null && p.amount > 0;
}

// ─── output normalization ───────────────────────────────────────────────────

/** Shape mirroring `AiParsedExpense` (src/lib/validation) field-for-field, but
 *  NOT yet schema-validated — this is the untrusted midpoint between the
 *  model's raw output and the zod boundary the feature layer runs before
 *  trusting the result (guardrail #6). */
export interface NormalizedDeviceParse {
  amount: number | null;
  currency: string | null;
  type: TransactionType | null;
  category: string | null;
  payee: string | null;
  account: string | null;
  note: string | null;
  occurredAt: number | null;
  confidence: number;
}

/** Placeholder words a required text field may come back with when the model
 *  has nothing real to say (it can't omit a required field, so it fills one of
 *  these). All map to null. */
const NULLISH_TOKENS = new Set([
  'unknown', 'none', 'n/a', 'na', 'null', 'nil', 'unspecified', 'unclear', '-',
]);

function toNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed.length) return null;
  return NULLISH_TOKENS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** The model reports the amount in MAJOR units (dollars) exactly as stated —
 *  asking a small on-device model to also multiply into cents was unreliable
 *  and invited it to echo the example number from the schema description. We
 *  do the ×100 into the minor units `aiParsedExpenseSchema` requires here.
 *  A non-positive/absent value means "the model didn't know" and becomes null
 *  so the rest of the parse still survives validation. */
function toUsableAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const minor = Math.round(n * 100);
  return minor > 0 ? minor : null;
}

/** Resolve common relative-date phrases in the user's OWN text to an epoch ms
 *  (local noon of the referenced day). The small on-device model is unreliable
 *  at date reasoning — it returned "today" for a "… yesterday" input even when
 *  handed both dates — so the feature layer prefers this deterministic reading
 *  over the model's occurredOn. Returns null when no recognised relative phrase
 *  is present (the caller then falls back to the model's date, else "now").
 *  Covers the casual-logging cases; absolute dates ("July 3") are left to the
 *  model / the "now" default. */
export function resolveRelativeDate(text: string, now: number): number | null {
  const t = text.toLowerCase();
  const DAY = 86_400_000;
  const noonDaysAgo = (n: number): number => {
    const d = new Date(now - n * DAY);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  };
  if (/\bday before yesterday\b/.test(t)) return noonDaysAgo(2);
  if (/\byesterday\b/.test(t)) return noonDaysAgo(1);
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return noonDaysAgo(0);
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{1,2})\s+days?\s+ago\b/.exec(t))) return noonDaysAgo(Number(m[1]));
  if ((m = /\b(\d{1,2})\s+weeks?\s+ago\b/.exec(t))) return noonDaysAgo(Number(m[1]) * 7);
  if (/\blast week\b/.test(t) || /\b(?:a|one)\s+week\s+ago\b/.test(t)) return noonDaysAgo(7);
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};
const MONTH_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|' +
  'aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DAY_RE = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR_RE = '(?:\\s*,?\\s*(\\d{4}))?';

/** epoch ms at local noon for (year, month0, day), or null for an impossible
 *  date (e.g. Feb 31 rolling into March). */
function localNoon(year: number, month0: number, day: number): number | null {
  const d = new Date(year, month0, day, 12, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month0 || d.getDate() !== day) {
    return null;
  }
  return d.getTime();
}

/** Build a local-noon epoch, inferring the year when not given: use the current
 *  year, or last year if that would land in the future (a bare "24th June" said
 *  in July means this year; said in May means last year). */
function resolvePastDate(
  year: number | undefined,
  month0: number,
  day: number,
  now: number
): number | null {
  const baseYear = year ?? new Date(now).getFullYear();
  const ts = localNoon(baseYear, month0, day);
  if (ts == null) return null;
  if (year == null && ts > now) return localNoon(baseYear - 1, month0, day);
  return ts;
}

/** Resolve an absolute calendar date written in the user's OWN text — numeric
 *  ("24/06/2026", "24-6"), day-first ("24th June"), or month-first ("June 24",
 *  "3 May 2025") — to epoch ms at local noon. Same reason as resolveRelativeDate:
 *  the on-device model returns "today" for absolute dates too, so parse the
 *  common forms deterministically. With no explicit year, use the most recent
 *  PAST occurrence. Returns null when no recognisable absolute date is present. */
export function resolveAbsoluteDate(text: string, now: number): number | null {
  const t = text.toLowerCase();

  // Numeric DD/MM[/YYYY] (day-first, e.g. "24/06/2026"). The slash/dash keeps
  // this from matching bare amounts. Day-first by default; if it's unambiguously
  // month/day (first part >12), swap. 2-digit years map to 2000s.
  const nm = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(t);
  if (nm) {
    let d = Number(nm[1]);
    let mo = Number(nm[2]);
    if (d <= 12 && mo > 12) [d, mo] = [mo, d]; // written MM/DD
    let yr = nm[3] != null ? Number(nm[3]) : undefined;
    if (yr != null && yr < 100) yr += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const ts = resolvePastDate(yr, mo - 1, d, now);
      if (ts != null) return ts;
    }
  }

  let day: number | undefined;
  let monthKey: string | undefined;
  let year: number | undefined;

  // Month-first ("June 24[th] [2025]") is tried before day-first so an amount
  // adjacent to the month ("spent 10 June 24") reads the date as "June 24", not
  // the amount "10" as the day ("10 June").
  let m = new RegExp(`\\b(${MONTH_RE})\\s+${DAY_RE}${YEAR_RE}\\b`).exec(t);
  if (m) {
    monthKey = m[1];
    day = Number(m[2]);
    year = m[3] ? Number(m[3]) : undefined;
  } else {
    // "24th June [2025]" / "24 of June"
    m = new RegExp(`\\b${DAY_RE}\\s+(?:of\\s+)?(${MONTH_RE})${YEAR_RE}\\b`).exec(t);
    if (m) {
      day = Number(m[1]);
      monthKey = m[2];
      year = m[3] ? Number(m[3]) : undefined;
    }
  }
  if (day == null || monthKey == null) return null;
  const month = MONTHS[monthKey];
  if (month == null || day < 1 || day > 31) return null;
  return resolvePastDate(year, month, day, now);
}

/** True when `name` appears as a whole word in `text` (case-insensitive). Used
 *  to reject an on-device account the model asserted but the user never typed:
 *  the small model tends to pick from the grounded account list even when no
 *  account is named, which would otherwise be treated as "matched" and defeat
 *  the defaulted-account pill. */
export function mentionedInText(name: string, text: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return new RegExp(boundedNamePattern(n), 'i').test(text);
}

/** Reject a hallucinated account or payee: the small on-device model tends to
 *  pick a plausible entry from the grounded lists even when the user named
 *  neither ("received $1000 salary today" returned a past payee, "Malaysia
 *  Trip", that isn't in the text at all). Both fields survive only when their
 *  name actually appears in the user's own words — a genuinely new payee
 *  typed by the user ("paid John 20") still passes, since "John" is in the
 *  text. Dropping either leaves it null so interpret() falls back (account) or
 *  leaves it unset (payee), flagging both as defaulted. */
export function applyGroundingGuards(
  parsed: NormalizedDeviceParse,
  text: string
): NormalizedDeviceParse {
  const payee = parsed.payee ? stripGluedAmount(parsed.payee, parsed.amount) : null;
  return {
    ...parsed,
    account: parsed.account && mentionedInText(parsed.account, text) ? parsed.account : null,
    payee: payee && mentionedInText(payee, text) ? payee : null,
  };
}

/** The model sometimes glues the trailing amount onto the payee ("groceries at
 *  NTUC 80" → payee "NTUC 80"); prompt instructions don't stop it (probed), so
 *  strip it deterministically. Only when the trailing number equals the parsed
 *  amount — a name whose trailing digits are NOT the amount ("Studio 54" for a
 *  $12 spend) stays intact. `amount` is minor units. */
function stripGluedAmount(payee: string, amount: number | null): string {
  if (amount == null) return payee;
  const m = /^(.*\S)\s+\$?(\d+(?:\.\d+)?)$/.exec(payee.trim());
  if (!m) return payee;
  return Math.round(Number(m[2]) * 100) === amount ? m[1]! : payee;
}

/** Convert the model's YYYY-MM-DD (see the occurredOn field) into epoch ms at
 *  LOCAL noon — noon avoids DST/midnight off-by-one when the day is rendered
 *  later. Returns null for anything that isn't a plausible calendar date;
 *  interpret() then defaults a null date to "now" and rejects out-of-range
 *  ones. Used only as a fallback when neither text resolver finds a date. */
function toEpochFromDateString(v: unknown): number | null {
  const s = toNullableString(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Reject impossible dates (e.g. 2026-02-31 rolling over to March).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d.getTime();
}

/** Currency survives only as an uppercased 3-letter ISO-4217-shaped code —
 *  a chatty answer like "US dollars" would otherwise fail
 *  `aiParsedExpenseSchema` and throw away the whole parse. */
function toCurrencyCode(v: unknown): string | null {
  const s = toNullableString(v);
  if (!s || !/^[A-Za-z]{3}$/.test(s)) return null;
  return s.toUpperCase();
}

function toConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normalize the model's guided-generation output (schema-shaped but still
 * untrusted: strings may be empty/padded, numbers out of the app's accepted
 * ranges) into the nullable AiParsedExpense shape. Never throws — unusable
 * fields become null (or 0 for confidence) rather than propagating garbage.
 */
export function normalizeDeviceParseOutput(
  raw: Record<string, unknown>
): NormalizedDeviceParse {
  const type = toNullableString(raw.type);
  return {
    amount: toUsableAmount(raw.amount),
    currency: toCurrencyCode(raw.currency),
    type: type && (KNOWN_TYPES as readonly string[]).includes(type) ? (type as TransactionType) : null,
    category: toNullableString(raw.category),
    payee: toNullableString(raw.payee),
    account: toNullableString(raw.account),
    note: toNullableString(raw.note),
    occurredAt: toEpochFromDateString(raw.occurredOn),
    confidence: toConfidence(raw.confidence),
  };
}
