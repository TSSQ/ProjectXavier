/**
 * Guided-generation schema for account UPDATE extraction — the sibling of
 * `accountParseSchema.ts`'s create contract (docs/design/account-chat-crud-
 * spec.md §5.2). Extracts STRINGS ONLY — `targetName`, `operation`, `newName`,
 * `newSubtype` — deliberately no balance field at all: the new balance is
 * ALWAYS `parseOpeningBalance(text)` (src/domain/accountAssistant.ts), read
 * from the raw text, never the model's number (same discipline as create).
 *
 * All four fields are required (not `.optional()`/`.nullable()`), for the
 * same binding reasons `accountParseSchema`/`deviceParseSchema` document: the
 * on-device JSON-schema converter can't express a nullable union, and the
 * small on-device model treats an `.optional()` field as licence to omit it.
 * An absent value is signalled with a sentinel ("" for the two name fields,
 * "unknown" for `operation`/`newSubtype`) instead.
 */
import { z } from 'zod';
import { zodSchema } from 'ai';
import { ACCOUNT_SUBTYPES } from './accountParseSchema';

/** "unknown" is the sentinel for "the text doesn't clearly say" — never a
 *  real operation; the deterministic verb-pattern classification in the
 *  chat flow (app/(tabs)/index.tsx) is the PRIMARY classifier — the model's
 *  `operation` is only a tiebreak/enhancement, re-resolved there, never
 *  trusted outright (spec §6.2 verdict). */
export const ACCOUNT_UPDATE_OPERATIONS = ['rename', 'retype', 'rebalance', 'unknown'] as const;
export type AccountUpdateOperation = (typeof ACCOUNT_UPDATE_OPERATIONS)[number];

export const accountUpdateParseSchema = z.object({
  targetName: z
    .string()
    .describe(
      'The account, wallet, or card the user is referring to, copied from ' +
        'their own words (e.g. "DBS Savings", "my wallet", "the card"). Use ' +
        'an empty string "" ONLY when the text truly names no target — never ' +
        'invent a name that does not appear in the text.'
    ),
  operation: z
    .enum(ACCOUNT_UPDATE_OPERATIONS)
    .describe(
      '"rename" when the user wants to change the account\'s NAME, ' +
        '"retype" when they want to change its KIND (e.g. wallet -> credit ' +
        'card), "rebalance" when they want to change its BALANCE/amount, or ' +
        '"unknown" only when the text truly gives no clue.'
    ),
  newName: z
    .string()
    .describe(
      'The NEW name the user wants the account renamed to, copied from ' +
        'their own words. Use an empty string "" when no new name is given ' +
        '— never invent one.'
    ),
  newSubtype: z
    .enum(ACCOUNT_SUBTYPES)
    .describe(
      'The NEW kind of account the user wants it changed to: "cash" for a ' +
        'wallet/cash account, "bank" for a checking/current/savings bank ' +
        'account, "credit_card" for a credit or debit card, "loan" for a ' +
        'loan or mortgage, "investment" for a brokerage/investment account, ' +
        'or "unknown" only when the text truly gives no clue.'
    ),
});

export type AccountUpdateParseModelOutput = z.infer<typeof accountUpdateParseSchema>;

/**
 * The POST-normalization shape (CLAUDE.md guardrail #6) — mirrors
 * `accountDraftSchema`: every field may fall back to its "nothing usable"
 * sentinel (`null` for the two name fields, "unknown" for the other two)
 * after the token-support guard / fallback logic in
 * `accountUpdatePrompt.ts`'s `normalizeAccountUpdateOutput`.
 */
export const accountUpdateDraftSchema = z.object({
  targetName: z.string().max(100).nullable(),
  operation: z.enum(ACCOUNT_UPDATE_OPERATIONS),
  newName: z.string().max(100).nullable(),
  newSubtype: z.enum(ACCOUNT_SUBTYPES),
});

export type AccountUpdateDraftExtraction = z.infer<typeof accountUpdateDraftSchema>;

/** JSON Schema handed to the BYOK cloud engines — same `zodSchema()`
 *  conversion as `ACCOUNT_PARSE_JSON_SCHEMA`, computed once at module load. */
export const ACCOUNT_UPDATE_PARSE_JSON_SCHEMA = zodSchema(accountUpdateParseSchema)
  .jsonSchema as Record<string, unknown>;
