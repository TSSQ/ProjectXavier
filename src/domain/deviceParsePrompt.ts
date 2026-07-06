/**
 * On-device (Apple Foundation Models) parse tier — pure, framework-free bits.
 *
 * Mirrors the cloud proxy's parse contract (supabase/functions/parse/index.ts)
 * so the same interpret()/draft-card/save path (src/domain/assistant.ts) can
 * consume either engine's output unchanged. The native binding
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

// ─── guided-generation schema ───────────────────────────────────────────────

/** Schema handed to `generateObject` as the Foundation Models guided-
 *  generation contract. Field names/intent mirror `aiParsedExpenseSchema`
 *  (src/lib/validation) and the cloud EXPENSE_SCHEMA
 *  (supabase/functions/parse/index.ts). Deliberately looser than
 *  `aiParsedExpenseSchema` (no positive/length constraints) so a marginal
 *  model answer still comes back and normalization decides what survives. */
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
      'The specific merchant, business, or person named (e.g. "Starbucks", ' +
        '"Shell"); reuse a known payee on an exact match, otherwise use the ' +
        'name as written. Use an empty string "" ONLY when no specific ' +
        'merchant/person is named -- a product or category word like "pizza" ' +
        'or "coffee" is NOT a payee.'
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

/** System instructions for the on-device session. Mirrors the cloud proxy's
 *  SYSTEM prompt intent (supabase/functions/parse/index.ts). */
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
    'Set "payee" to the specific merchant, business, or person named (e.g.',
    '"Starbucks", "Shell"); reuse a known payee on an exact match, otherwise use',
    'the name as written. Use an empty string "" for payee only when no specific',
    'merchant/person is named — a product or category word like "pizza" or',
    '"coffee" is NOT a payee.',
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
 *  time, then the expense text itself. Mirrors the cloud proxy's `content`
 *  assembly (supabase/functions/parse/index.ts). */
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
        'Reuse an exact match when appropriate.'
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

/** Convert the model's YYYY-MM-DD (see the occurredOn field) into epoch ms at
 *  LOCAL noon — noon avoids DST/midnight off-by-one when the day is rendered
 *  later. Returns null for anything that isn't a plausible calendar date;
 *  interpret() then defaults a null date to "now" and rejects out-of-range
 *  ones. Used only as a fallback when resolveRelativeDate finds no phrase. */
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
