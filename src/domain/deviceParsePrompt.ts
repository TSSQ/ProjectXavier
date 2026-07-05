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
 * Unlike the previous binding (react-native-apple-llm), @react-native-ai/apple
 * accepts a real zod schema for guided generation — no sentinel values, no
 * lossy re-encoding. One constraint remains: the binding's native JSON-schema
 * converter (AppleLLMImpl.swift parseDynamicSchema) reads `type` as a single
 * string, so a `.nullable()` union (`["string","null"]`/anyOf) is rejected as
 * "Unsupported schema type" — but it maps non-`required` properties to
 * DynamicGenerationSchema's `isOptional`. Unknown-able fields are therefore
 * `.optional()` here (the model omits what it can't determine) and
 * normalization turns the omissions into the `null`s the app's contract
 * expects. The feature layer still treats the model's output as untrusted and
 * re-validates the normalized result against `aiParsedExpenseSchema`
 * (src/lib/validation) before use (guardrail #6).
 */
import { z } from 'zod';
import { TransactionType, Category, Payee } from './types';

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
    .optional()
    .describe(
      'The transaction amount as a decimal in the main currency unit, exactly ' +
        'as the user stated it — "twenty" or "$20" is 20, "twelve fifty" or ' +
        '"$12.50" is 12.5. Do NOT convert to cents. Omit if the amount cannot ' +
        'be determined with reasonable confidence.'
    ),
  currency: z
    .string()
    .optional()
    .describe('ISO 4217 code, e.g. "USD". Omit if unknown.'),
  type: z
    .enum(['expense', 'income', 'transfer'])
    .optional()
    .describe('The kind of transaction. Omit if it cannot be inferred.'),
  category: z
    .string()
    .optional()
    .describe(
      'A concise spending category that fits the expense (e.g. "Groceries", ' +
        '"Dining", "Transport"): prefer one of the known categories when it ' +
        'fits, otherwise propose a new concise name. Do NOT omit this just ' +
        'because nothing matches the known list.'
    ),
  payee: z
    .string()
    .optional()
    .describe(
      'The specific merchant, business, or person named (e.g. "Starbucks", ' +
        '"Shell"); reuse a known payee on an exact match, otherwise use the ' +
        'name as written. Omit only when no specific merchant/person is ' +
        'named -- a product or category word like "pizza" or "coffee" is NOT ' +
        'a payee.'
    ),
  account: z
    .string()
    .optional()
    .describe(
      'Name of the account/card the user said they used, matching one of ' +
        'the provided user accounts. Omit if not stated.'
    ),
  note: z
    .string()
    .optional()
    .describe('Any additional free-text note. Omit if none.'),
  occurredAt: z
    .number()
    .optional()
    .describe('Epoch milliseconds the transaction occurred. Omit if unknown.'),
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
  /** Injected clock — never call Date.now() inside this module. */
  now: number;
}

/** System instructions for the on-device session. Mirrors the cloud proxy's
 *  SYSTEM prompt intent (supabase/functions/parse/index.ts). */
export function buildDeviceParseInstructions(): string {
  return [
    'You convert a short expense description into structured data.',
    'Report "amount" as a decimal in the main currency unit, exactly as the',
    'user stated it ("$20" -> 20, "$12.50" -> 12.5) — do NOT convert to cents.',
    'Infer the transaction type.',
    'Always set "category" to a concise spending category that fits the expense',
    '(e.g. "Groceries", "Dining", "Transport"): prefer one of the user’s known',
    'categories when it fits, otherwise propose a new concise name — do NOT',
    'return null for category just because nothing matches the known list.',
    'Set "payee" to the specific merchant, business, or person named (e.g.',
    '"Starbucks", "Shell"); reuse a known payee on an exact match, otherwise use',
    'the name as written. Omit payee only when no specific merchant/person',
    'is named — a product or category word like "pizza" or "coffee" is NOT a payee.',
    'For all OTHER fields (amount, currency, account, occurredAt) omit the field',
    'rather than guessing when you cannot determine it with reasonable',
    'confidence.',
    'Set "confidence" to your overall confidence in the parse from 0 to 1.',
  ].join(' ');
}

/** User-turn prompt: grounds the model in the user's existing entities (so it
 *  maps to them instead of inventing duplicates) plus the device's current
 *  time, then the expense text itself. Mirrors the cloud proxy's `content`
 *  assembly (supabase/functions/parse/index.ts). */
export function buildDeviceParsePrompt(text: string, ctx: DeviceParseContext): string {
  const nowIso = new Date(ctx.now).toISOString().split('T')[0];
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
  return (
    `Today's date is ${nowIso} (epoch ms: ${ctx.now}). When the user says "today" ` +
    `or gives no date, use ${ctx.now} for occurredAt. ` +
    (hints.length ? hints.join(' ') + ' ' : '') +
    `Expense: ${text}`
  );
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

function toNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
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

function toNullableInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
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
    occurredAt: toNullableInt(raw.occurredAt),
    confidence: toConfidence(raw.confidence),
  };
}
