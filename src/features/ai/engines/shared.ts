/**
 * Shared BYOK cloud-engine internals — the normalize/guard/date-override/
 * re-validate pipeline every cloud engine (anthropic.ts, openai.ts) runs on
 * whatever raw model object its own provider-specific `fetch` produced.
 *
 * Cloud parse used to go through the Vercel AI SDK's `generateObject`, but
 * that routes through `@ai-sdk/provider-utils`'s HTTP path, which depends on
 * web-streams (`ReadableStream`/`TextDecoderStream`/`TransformStream`) that
 * Hermes/React Native does not provide (see memory
 * `byok-generateobject-rn-incompat` and docs/design/byok-raw-fetch-spec.md).
 * Each engine now does a raw `fetch` to the provider's REST API instead —
 * mirroring the network hygiene already proven in
 * `src/features/ai/listModels.ts` — and hands this module the raw
 * (still-untrusted) model object. Only that "produce the raw object" step
 * differs per provider; everything below is identical to before, and
 * identical to `src/features/ai/deviceParse.ts`'s on-device pipeline (same
 * `normalizeDeviceParseOutput` / `applyGroundingGuards` from
 * `src/domain/deviceParsePrompt.ts`, re-validated with `aiParsedExpenseSchema`).
 *
 * Network hygiene (docs/design/byok-raw-fetch-spec.md): every call carries an
 * AbortController timeout, and ANY failure (bad key, offline, timeout, rate
 * limit, a response with no usable structured output, or output that fails
 * re-validation) resolves to a `{ ok: false, reason }` result rather than
 * throwing — the caller (src/domain/parseRouter.ts's ordering, driven from
 * app/(tabs)/index.tsx) always has a safe fallback to Foundation Models /
 * the heuristic, and can now SAY that the key didn't answer (and roughly
 * why) instead of passing the fallback off as the normal path. The key, the
 * Authorization/x-api-key header, and raw request/response content are NEVER
 * logged — only a generic, key-free label reaches `console.warn`.
 */
import { ZodTypeAny } from 'zod';
import { aiParsedExpenseSchema, AiParsedExpense } from '../../../lib/validation';
import { Category, Payee, Account } from '../../../domain/types';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  resolveTypedDate,
} from '../../../domain/deviceParsePrompt';
import { DEVICE_PARSE_JSON_SCHEMA } from '../../../domain/cloudParseSchema';
import { accountParseSchema, ACCOUNT_PARSE_JSON_SCHEMA } from '../../../domain/accountParseSchema';
import {
  buildAccountParseInstructions,
  buildAccountParsePrompt,
  normalizeAccountParseOutput,
  AccountExtraction,
} from '../../../domain/accountParsePrompt';
import {
  accountUpdateParseSchema,
  ACCOUNT_UPDATE_PARSE_JSON_SCHEMA,
} from '../../../domain/accountUpdateSchema';
import {
  buildAccountUpdateInstructions,
  buildAccountUpdatePrompt,
  normalizeAccountUpdateOutput,
  AccountUpdateDraftExtraction,
} from '../../../domain/accountUpdatePrompt';
import {
  transactionOpSelectionSchema,
  TRANSACTION_OP_SELECTION_JSON_SCHEMA,
  buildTransactionOpInstructions,
  buildTransactionOpPrompt,
  normalizeTransactionOpSelection,
} from '../../../domain/transactionOpSelection';
import {
  classifyCloudParseStatus,
  CloudParseFailure,
  isRecord,
} from '../../../domain/cloudParseTransport';

/** Abort a request that hasn't resolved within this long — a hung or very
 *  slow connection must still fall through to the next parse tier promptly
 *  rather than leaving the user staring at a spinner. */
export const CLOUD_REQUEST_TIMEOUT_MS = 15_000;

export interface CloudParseContext {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** Device clock (ms since epoch) — the caller's "now", never Date.now()
   *  read inside this module. */
  now: number;
  /** The app's active currency (ISO 4217, e.g. "USD", "JPY") — the expense
   *  contract scales the model's major-unit amount into minor units by THIS
   *  currency's exponent (`normalizeDeviceParseOutput` /
   *  `applyGroundingGuards`, src/domain/deviceParsePrompt.ts), exactly as
   *  the on-device path (src/domain/fmParse.ts) already does. Omitting it
   *  used to silently default to USD, so a JPY "coffee 500" via BYOK stored
   *  50000 minor units. REQUIRED so no caller can forget it again. */
  currency: string;
  /** Only meaningful for `ACCOUNT_PARSE_CONTRACT` — the deterministic
   *  account-intent gate's subtype guess (src/domain/accountIntent.ts),
   *  seeded into the prompt and used as the normalize fallback. Undefined
   *  (and ignored) for the expense contract. */
  accountSubtypeHint?: string;
}

/**
 * A parse engine contract (docs/design/account-chat-creation-spec.md §5.2) —
 * lets `runCloudParse`/`fetchOpenAiRaw`/`fetchAnthropicRaw` run EITHER the
 * expense contract (today's behavior, unchanged) or the account contract
 * without a forked engine stack. `fmSchema` is for the on-device Foundation
 * Models tier's `generateObject` call (src/features/ai/deviceParse.ts);
 * `jsonSchema`/`toolName` are for the BYOK cloud engines' structured-output
 * request bodies.
 */
export interface ParseContract<T> {
  instructions: () => string;
  buildPrompt: (text: string, ctx: CloudParseContext) => string;
  fmSchema: ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  /** Anthropic's forced tool name (`tools[].name` / `tool_choice.name`). */
  toolName: string;
  toolDescription: string;
  /** OpenAI's `response_format.json_schema.name` — kept separate from
   *  `toolName` because the ORIGINAL expense engines already used two
   *  different literal strings here ('expense' for OpenAI, 'record_expense'
   *  for Anthropic); defaults to `toolName` when a contract (e.g. the new
   *  account one) has no reason to differ. */
  jsonSchemaName?: string;
  /** Guard + re-validate the raw (still-untrusted) model object into `T`, or
   *  `null` when it doesn't survive. */
  normalize: (raw: Record<string, unknown>, text: string, ctx: CloudParseContext) => T | null;
}

/** The expense contract — identical to the pipeline every cloud engine has
 *  always run (guardrail #6: grounding guards, deterministic date override,
 *  then re-validate against `aiParsedExpenseSchema`). Extracted out of
 *  `runCloudParse`'s body so it can double as `runCloudParse`'s default
 *  `normalize` AND the `ParseContract` the expense engines pass explicitly —
 *  a single source of truth for "today's behavior, unchanged". */
function normalizeExpenseParse(
  raw: Record<string, unknown>,
  text: string,
  ctx: CloudParseContext
): AiParsedExpense | null {
  // Both steps take the active currency (JPY "coffee 500" -> 500 minor, not
  // 50000) — the same two calls fmParse.ts makes for the on-device tier.
  const normalized = applyGroundingGuards(
    normalizeDeviceParseOutput(raw, ctx.currency),
    text,
    ctx.currency
  );
  // Cloud models keep their own date as the fallback — unlike the on-device
  // model (deviceParse.ts), they read undated text as today.
  const textDate = resolveTypedDate(text, ctx.now);
  if (textDate != null) normalized.occurredAt = textDate;
  const validated = aiParsedExpenseSchema.safeParse(normalized);
  return validated.success ? validated.data : null;
}

export const EXPENSE_PARSE_CONTRACT: ParseContract<AiParsedExpense> = {
  instructions: buildDeviceParseInstructions,
  buildPrompt: buildDeviceParsePrompt,
  fmSchema: deviceParseSchema,
  jsonSchema: DEVICE_PARSE_JSON_SCHEMA,
  toolName: 'record_expense',
  toolDescription: "Record the structured expense extracted from the user's text.",
  // The original fetchOpenAiRaw hardcoded 'expense' here (a different string
  // from Anthropic's 'record_expense' tool name) — preserved so the expense
  // path's OpenAI request body is byte-for-byte unchanged.
  jsonSchemaName: 'expense',
  normalize: normalizeExpenseParse,
};

/** The account-creation contract (spec §5.3) — extracts {name, subtype}
 *  only; no balance field exists anywhere in this contract
 *  (src/domain/accountAssistant.ts's `parseOpeningBalance` is the only thing
 *  allowed to produce one). */
export const ACCOUNT_PARSE_CONTRACT: ParseContract<AccountExtraction> = {
  instructions: buildAccountParseInstructions,
  // Thin adapters translating the shared `CloudParseContext.accountSubtypeHint`
  // into the account contract's own narrower, domain-level
  // `AccountParseContext` ({ subtypeHint }) — src/domain/accountParsePrompt.ts
  // stays framework-free and doesn't know about the engines' shared ctx shape.
  buildPrompt: (text, ctx) => buildAccountParsePrompt(text, { subtypeHint: ctx.accountSubtypeHint }),
  fmSchema: accountParseSchema,
  jsonSchema: ACCOUNT_PARSE_JSON_SCHEMA,
  toolName: 'record_account',
  toolDescription: "Record the structured account details extracted from the user's text.",
  normalize: (raw, text, ctx) => normalizeAccountParseOutput(raw, text, ctx.accountSubtypeHint),
};

/** The account-UPDATE contract (docs/design/account-chat-crud-spec.md §5.2)
 *  — extracts {targetName, operation, newName, newSubtype} only; no balance
 *  field exists anywhere in this contract (the flow layer applies
 *  `parseOpeningBalance` to the raw text directly, never to anything from
 *  this contract). */
export const ACCOUNT_UPDATE_PARSE_CONTRACT: ParseContract<AccountUpdateDraftExtraction> = {
  instructions: buildAccountUpdateInstructions,
  buildPrompt: (text, ctx) =>
    buildAccountUpdatePrompt(text, { subtypeHint: ctx.accountSubtypeHint }),
  fmSchema: accountUpdateParseSchema,
  jsonSchema: ACCOUNT_UPDATE_PARSE_JSON_SCHEMA,
  toolName: 'record_account_update',
  toolDescription:
    "Record the structured account CHANGE extracted from the user's text.",
  normalize: (raw, text, ctx) => normalizeAccountUpdateOutput(raw, text, ctx.accountSubtypeHint),
};

/** The chat transaction delete/update contract (docs/design/chat-
 *  transaction-delete-update-spec.md §5.2) — ONE enum, `'delete' |
 *  'update'`, and nothing else: no id, amount, date, payee or account name
 *  ever crosses this boundary in either direction. `buildPrompt` ignores
 *  `ctx` entirely (spec §5.2: "Message: ${text}" and nothing else — no
 *  grounding lists, unlike every other contract here) — see
 *  transactionOpSelection.ts's header for why that's a deliberate, re-probed
 *  deviation from the account/expense contracts' grounding convention. */
export const TRANSACTION_OP_PARSE_CONTRACT: ParseContract<'delete' | 'update'> = {
  instructions: buildTransactionOpInstructions,
  buildPrompt: (text) => buildTransactionOpPrompt(text),
  fmSchema: transactionOpSelectionSchema,
  jsonSchema: TRANSACTION_OP_SELECTION_JSON_SCHEMA,
  toolName: 'record_transaction_op',
  toolDescription:
    "Record what the user wants to do to a transaction they've already recorded.",
  normalize: (raw) => normalizeTransactionOpSelection(raw),
};

/** What a provider-specific raw fetch hands back: the REAL HTTP status plus
 *  the raw, still-untrusted model object (`null` for a non-2xx status or an
 *  unusable response shape). Both `fetchOpenAiRaw` and `fetchAnthropicRaw`
 *  already return this shape (their `OpenAiRawResult`/`AnthropicRawResult`
 *  are structurally identical to it). */
export interface CloudRawFetchResult {
  status: number;
  raw: unknown | null;
}

/** Outcome of `runCloudParse`: the validated contract value, or WHY there
 *  isn't one — a small, key-free `CloudParseFailure` (src/domain/
 *  cloudParseTransport.ts) the chat screen surfaces on the draft card and
 *  records on the parse-metrics row instead of silently falling through. */
export type CloudParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CloudParseFailure };

/**
 * Run the shared normalize/guard/validate parse contract against whatever raw
 * model object `fetchRaw` produces, returning `{ ok: true, value }` with the
 * validated contract value, or `{ ok: false, reason }` on ANY failure:
 * `network` for a network/timeout/abort error thrown by `fetchRaw`;
 * `auth`/`not_found`/`rate_limited`/`network` by the real HTTP status for a
 * non-2xx response (src/domain/cloudParseTransport.ts's
 * `classifyCloudParseStatus`); `bad_output` for a 2xx whose raw object isn't
 * even a record per `isRecord` (a bare array/string/number, or a
 * provider-specific `fetchRaw` returning `raw: null` for its own failure
 * shapes — the SAME `isRecord` gate `testByokKey` classifies `ok` on, so the
 * two can never disagree on "usable") or that doesn't survive the contract's
 * `normalize`. Never throws. The reason is derived ONLY from the status, the
 * error's kind, or "extraction/validation failed" — never from the body, and
 * nothing here logs the key, a header, or any request/response content (the
 * one `console.warn` carries the engine label and the error's constructor
 * name).
 *
 * @param fetchRaw Provider-specific: performs the raw `fetch` (using the
 *   given `AbortSignal` for this shared timeout) and returns the real status
 *   plus the raw, still-untrusted model object, or `raw: null` for a non-2xx
 *   status or an unusable response shape. May itself throw (network error,
 *   abort) — that is caught here and classified `network`.
 * @param normalize The contract's guard/re-validate step — REQUIRED, no
 *   default (reviewer follow-up: a defaulted `normalize` typed generically
 *   over `T` could only be satisfied by an unsound `as unknown as` cast,
 *   which let a caller ask for `T = AccountExtraction` while silently
 *   running the expense normalize function at runtime). Pass
 *   `EXPENSE_PARSE_CONTRACT.normalize` for the expense contract or
 *   `ACCOUNT_PARSE_CONTRACT.normalize` for the account contract
 *   (docs/design/account-chat-creation-spec.md §5.2) — there is no way to
 *   get `T` and `normalize` out of sync without a type error.
 */
export async function runCloudParse<T>(
  fetchRaw: (signal: AbortSignal) => Promise<CloudRawFetchResult>,
  text: string,
  ctx: CloudParseContext,
  engineLabel: string,
  normalize: (raw: Record<string, unknown>, text: string, ctx: CloudParseContext) => T | null
): Promise<CloudParseResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const { status, raw } = await fetchRaw(controller.signal);
    const statusFailure = classifyCloudParseStatus(status);
    if (statusFailure) {
      // Status code only — never the response body.
      console.warn(`${engineLabel} parse failed:`, statusFailure);
      return { ok: false, reason: statusFailure };
    }
    if (!isRecord(raw)) return { ok: false, reason: 'bad_output' };

    // Same "guard, then re-validate" shape for every contract (guardrail #6
    // — the model's output is untrusted regardless of which provider or
    // contract produced it); which guard/validation actually runs is the
    // caller's own `normalize`, passed explicitly (no default — see above).
    const value = normalize(raw, text, ctx);
    return value === null ? { ok: false, reason: 'bad_output' } : { ok: true, value };
  } catch (e) {
    // Deliberately key/content-free: only the error's constructor name (e.g.
    // "AbortError", "TypeError") ever reaches the console — never the key,
    // the Authorization/x-api-key header, or the request/response body.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn(`${engineLabel} parse failed:`, label);
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
