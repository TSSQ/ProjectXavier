/**
 * On-device (Apple Foundation Models) parse tier — pure, framework-free bits.
 *
 * Mirrors the cloud proxy's parse contract (supabase/functions/parse/index.ts)
 * so the same interpret()/draft-card/save path (src/domain/assistant.ts) can
 * consume either engine's output unchanged. The native binding
 * (react-native-apple-llm) itself is only touched from the feature layer
 * (src/features/ai/deviceParse.ts) — this module has zero RN/Expo imports so
 * it stays testable in the plain-node BDD suite.
 *
 * Binding quirk this module works around: react-native-apple-llm's structured
 * output schema (StructureSchema) has no nullable/union type — every field is
 * a required string/integer/number/boolean. There is no way to ask the model
 * to literally return `null`. We instead ask for SENTINEL values (an empty
 * string for "no text", a fixed out-of-range integer for "no number") and
 * normalize those sentinels back to `null` here, matching the nullable shape
 * `aiParsedExpenseSchema` (src/lib/validation) expects. The feature layer
 * treats the model's raw output as untrusted and re-validates the normalized
 * result against that schema before use (guardrail #6).
 */
import { Category, Payee, TransactionType } from './types';

/** Mirrors react-native-apple-llm's `FoundationModelsAvailability` type
 *  locally (rather than importing it) so this module never pulls in the
 *  native package — importing it throws immediately in any environment
 *  without the native module linked (e.g. this plain-node test suite). */
export type DeviceAiAvailability =
  | 'available'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'unavailable';

/** Only the "available" state means Foundation Models can actually run —
 *  every other state (not enabled, still downloading, unsupported device)
 *  must fall through to the next tier (heuristic). */
export function isDeviceParseAvailable(state: DeviceAiAvailability | string): boolean {
  return state === 'available';
}

// ─── structured-output schema ───────────────────────────────────────────────

/** Local mirror of react-native-apple-llm's `StructureProperty`/`StructureSchema`
 *  shape (same reasoning as DeviceAiAvailability above: no import of the
 *  native package from this framework-free module). */
export interface DeviceStructureProperty {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  description?: string;
  enum?: string[];
}
export type DeviceStructureSchema = Record<string, DeviceStructureProperty>;

/** Sentinel integer meaning "the model could not determine this number" —
 *  chosen well outside any plausible amount/date range. */
export const AMOUNT_UNKNOWN_SENTINEL = -1;
export const OCCURRED_AT_UNKNOWN_SENTINEL = -1;

const KNOWN_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];

/** The JSON-schema-like descriptor passed as `structure` to
 *  `AppleLLMSession.generateStructuredOutput`. Field names/intent mirror
 *  `aiParsedExpenseSchema` (src/lib/validation) and the cloud EXPENSE_SCHEMA
 *  (supabase/functions/parse/index.ts); only the null-encoding differs. */
export const DEVICE_PARSE_STRUCTURE: DeviceStructureSchema = {
  amount: {
    type: 'integer',
    description:
      `Amount in MINOR units (cents): $12.50 -> 1250. Use ${AMOUNT_UNKNOWN_SENTINEL} ` +
      'if the amount cannot be determined with reasonable confidence.',
  },
  currency: {
    type: 'string',
    description: 'ISO 4217 code, e.g. "USD". Empty string "" if unknown.',
  },
  type: {
    type: 'string',
    enum: [...KNOWN_TYPES, 'unknown'],
    description: 'The kind of transaction. "unknown" if it cannot be inferred.',
  },
  category: {
    type: 'string',
    description:
      'A concise spending category that fits the expense (e.g. "Groceries", ' +
      '"Dining", "Transport"): prefer one of the known categories when it fits, ' +
      'otherwise propose a new concise name. Do NOT return "" just because ' +
      'nothing matches the known list.',
  },
  payee: {
    type: 'string',
    description:
      'The specific merchant, business, or person named (e.g. "Starbucks", ' +
      '"Shell"); reuse a known payee on an exact match, otherwise use the name ' +
      'as written. Empty string "" only when no specific merchant/person is ' +
      'named -- a product or category word like "pizza" or "coffee" is NOT a payee.',
  },
  account: {
    type: 'string',
    description:
      'Name of the account/card the user said they used, matching one of the ' +
      'provided user accounts. Empty string "" if not stated.',
  },
  note: {
    type: 'string',
    description: 'Any additional free-text note. Empty string "" if none.',
  },
  occurredAt: {
    type: 'integer',
    description:
      `Epoch milliseconds the transaction occurred. Use ${OCCURRED_AT_UNKNOWN_SENTINEL} ` +
      'if unknown.',
  },
  confidence: {
    type: 'number',
    description: 'Your overall confidence in the parse, from 0 to 1.',
  },
};

// ─── prompt construction ────────────────────────────────────────────────────

export interface DeviceParseContext {
  categories: Category[];
  payees: Payee[];
  /** Injected clock — never call Date.now() inside this module. */
  now: number;
}

/** System instructions for the on-device session. Mirrors the cloud proxy's
 *  SYSTEM prompt intent (supabase/functions/parse/index.ts), adapted for the
 *  sentinel-value convention this binding requires (see module doc comment). */
export function buildDeviceParseInstructions(): string {
  return [
    'You convert a short expense description into structured data.',
    'Return amounts in MINOR units (cents): $12.50 -> 1250.',
    'Infer the transaction type.',
    'Always set "category" to a concise spending category that fits the expense',
    '(e.g. "Groceries", "Dining", "Transport"): prefer one of the user’s known',
    'categories when it fits, otherwise propose a new concise name — do NOT',
    'return "" for category just because nothing matches the known list.',
    'Set "payee" to the specific merchant, business, or person named (e.g.',
    '"Starbucks", "Shell"); reuse a known payee on an exact match, otherwise use',
    'the name as written. Use "" for payee only when no specific merchant/person',
    'is named — a product or category word like "pizza" or "coffee" is NOT a payee.',
    'For all OTHER fields (amount, currency, account, occurredAt) use the',
    `documented "unknown" sentinel (${AMOUNT_UNKNOWN_SENTINEL} for numbers, "" for`,
    'text) rather than guessing when you cannot determine them with reasonable',
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
 *  model's raw (sentinel-laden, loosely-typed) output and the zod boundary
 *  the feature layer runs before trusting the result (guardrail #6). */
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

function toNullableInt(v: unknown, sentinel: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded === sentinel ? null : rounded;
}

function toConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normalize the model's raw structured-output object (untrusted: field types
 * and sentinel usage aren't guaranteed) into the nullable AiParsedExpense
 * shape. Never throws — unrecognised/missing fields become null (or 0 for
 * confidence) rather than propagating garbage.
 */
export function normalizeDeviceParseOutput(
  raw: Record<string, unknown>
): NormalizedDeviceParse {
  const type = toNullableString(raw.type);
  return {
    amount: toNullableInt(raw.amount, AMOUNT_UNKNOWN_SENTINEL),
    currency: toNullableString(raw.currency),
    type: type && (KNOWN_TYPES as readonly string[]).includes(type) ? (type as TransactionType) : null,
    category: toNullableString(raw.category),
    payee: toNullableString(raw.payee),
    account: toNullableString(raw.account),
    note: toNullableString(raw.note),
    occurredAt: toNullableInt(raw.occurredAt, OCCURRED_AT_UNKNOWN_SENTINEL),
    confidence: toConfidence(raw.confidence),
  };
}
