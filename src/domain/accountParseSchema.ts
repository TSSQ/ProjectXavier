/**
 * Guided-generation schema for account extraction — the account counterpart
 * of `deviceParsePrompt.ts`'s `deviceParseSchema`
 * (docs/design/account-chat-creation-spec.md §5.3). Extracts STRINGS ONLY —
 * `name` and `subtype` — deliberately no balance field at all:
 * `accountAssistant.ts`'s `parseOpeningBalance(text)` is the ONLY thing
 * allowed to produce a balance (probe finding #2, spec §3); the model's
 * number is never trusted.
 *
 * Both fields are required (not `.optional()`/`.nullable()`), for the same
 * binding reasons `deviceParseSchema` documents: the on-device JSON-schema
 * converter can't express a nullable union, and the small on-device model
 * treats an `.optional()` field as licence to omit it. An absent name/subtype
 * is signalled with a sentinel ("" for name, "unknown" for subtype) instead.
 *
 * `ACCOUNT_PARSE_JSON_SCHEMA` mirrors `cloudParseSchema.ts`'s
 * `DEVICE_PARSE_JSON_SCHEMA` pattern — the same `zodSchema()` (from the `ai`
 * package, already a runtime dependency) conversion, so the BYOK cloud
 * engines (OpenAI's `json_schema`, Anthropic's `input_schema`) get a JSON
 * Schema that can never drift from `accountParseSchema`.
 */
import { z } from 'zod';
import { zodSchema } from 'ai';

/** The account subtypes the extraction contract can propose. "unknown" is
 *  the sentinel for "the text doesn't say" — never a real subtype; callers
 *  (see `accountParsePrompt.ts`'s `normalizeAccountParseOutput`) fall back to
 *  the deterministic gate's `subtypeHint` when the model returns it. */
export const ACCOUNT_SUBTYPES = [
  'cash',
  'bank',
  'credit_card',
  'loan',
  'investment',
  'unknown',
] as const;

export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const accountParseSchema = z.object({
  name: z
    .string()
    .describe(
      'The account, wallet, or card name/institution the user said, copied ' +
        'from their own words (e.g. "DBS Savings", "Amex", "Wallet"). Use an ' +
        'empty string "" ONLY when the text truly names nothing — never invent ' +
        'a bank, card, or institution name that does not appear in the text.'
    ),
  subtype: z
    .enum(ACCOUNT_SUBTYPES)
    .describe(
      'The kind of account: "cash" for a wallet/cash account, "bank" for a ' +
        'checking/current/savings bank account, "credit_card" for a credit or ' +
        'debit card, "loan" for a loan or mortgage, "investment" for a ' +
        'brokerage/investment account, or "unknown" only when the text truly ' +
        'gives no clue.'
    ),
});

export type AccountParseModelOutput = z.infer<typeof accountParseSchema>;

/**
 * The POST-normalization shape (CLAUDE.md guardrail #6 — "validate every
 * trust boundary with zod, including AI/OCR output") — mirrors how
 * `aiParsedExpenseSchema` (src/lib/validation.ts) re-validates the expense
 * contract's normalized output before any caller trusts it. Unlike
 * `accountParseSchema` above (the RAW guided-generation contract handed to
 * the model), this validates what `normalizeAccountParseOutput`
 * (src/domain/accountParsePrompt.ts) assembles AFTER the token-support guard
 * and subtype-hint fallback: `name` may be `null` (discarded/absent), and
 * `subtype` is still any of `ACCOUNT_SUBTYPES` including "unknown".
 */
export const accountDraftSchema = z.object({
  name: z.string().max(100).nullable(),
  subtype: z.enum(ACCOUNT_SUBTYPES),
});

export type AccountDraftExtraction = z.infer<typeof accountDraftSchema>;

/** JSON Schema handed to the BYOK cloud engines — structurally identical to
 *  `accountParseSchema` (same keys, same enum values, same required split).
 *  Computed once at module load (see `cloudParseSchema.ts`'s header for why
 *  this conversion is synchronous and safe to run eagerly). */
export const ACCOUNT_PARSE_JSON_SCHEMA = zodSchema(accountParseSchema).jsonSchema as Record<
  string,
  unknown
>;
