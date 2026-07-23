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
 * re-validation) resolves to `null` rather than throwing — the caller (src/
 * domain/parseRouter.ts's ordering, driven from app/(tabs)/index.tsx) always
 * has a safe fallback to Foundation Models / the heuristic. The key, the
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
  resolveRelativeDate,
  resolveAbsoluteDate,
} from '../../../domain/deviceParsePrompt';
import { DEVICE_PARSE_JSON_SCHEMA } from '../../../domain/cloudParseSchema';
import { accountParseSchema, ACCOUNT_PARSE_JSON_SCHEMA } from '../../../domain/accountParseSchema';
import {
  buildAccountParseInstructions,
  buildAccountParsePrompt,
  normalizeAccountParseOutput,
  AccountExtraction,
} from '../../../domain/accountParsePrompt';
import { isRecord } from '../../../domain/cloudParseTransport';

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
  const normalized = applyGroundingGuards(normalizeDeviceParseOutput(raw), text);
  const textDate = resolveRelativeDate(text, ctx.now) ?? resolveAbsoluteDate(text, ctx.now);
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

/**
 * Run the shared normalize/guard/validate parse contract against whatever raw
 * model object `fetchRawObject` produces, returning a validated
 * `AiParsedExpense` on success or `null` on ANY failure — a network/timeout/
 * abort error thrown by `fetchRawObject`, a raw object that isn't even a
 * record per `isRecord` (a bare array/string/number, or a provider-specific
 * `fetchRawObject` returning `null` for its own failure shapes — see
 * src/domain/cloudParseTransport.ts, which `testByokKey` gates its `ok`
 * classification on with this SAME `isRecord` check so the two can never
 * disagree on "usable"), or output that doesn't survive
 * `aiParsedExpenseSchema`. Never throws.
 *
 * @param fetchRawObject Provider-specific: performs the raw `fetch` (using
 *   the given `AbortSignal` for this shared timeout) and returns the raw,
 *   still-untrusted model object, or `null` for a non-2xx status or an
 *   unusable response shape. May itself throw (network error, abort) — that
 *   is caught here exactly like any other failure.
 * @param normalize The contract's guard/re-validate step — REQUIRED, no
 *   default (reviewer follow-up: a defaulted `normalize` typed generically
 *   over `T` could only be satisfied by an unsound `as unknown as` cast,
 *   which let a caller ask for `T = AccountExtraction` while silently
 *   running the expense normalize function at runtime). Pass
 *   `EXPENSE_PARSE_CONTRACT.normalize` for the expense contract (today's
 *   behavior, unchanged) or `ACCOUNT_PARSE_CONTRACT.normalize` for the
 *   account contract (docs/design/account-chat-creation-spec.md §5.2) —
 *   there is no way to get `T` and `normalize` out of sync without a type
 *   error.
 */
export async function runCloudParse<T>(
  fetchRawObject: (signal: AbortSignal) => Promise<unknown>,
  text: string,
  ctx: CloudParseContext,
  engineLabel: string,
  normalize: (raw: Record<string, unknown>, text: string, ctx: CloudParseContext) => T | null
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const object = await fetchRawObject(controller.signal);
    if (!isRecord(object)) return null;

    // Same "guard, then re-validate" shape for every contract (guardrail #6
    // — the model's output is untrusted regardless of which provider or
    // contract produced it); which guard/validation actually runs is the
    // caller's own `normalize`, passed explicitly (no default — see above).
    return normalize(object, text, ctx);
  } catch (e) {
    // Deliberately key/content-free: only the error's constructor name (e.g.
    // "AbortError", "TypeError") ever reaches the console — never the key,
    // the Authorization/x-api-key header, or the request/response body.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn(`${engineLabel} parse failed:`, label);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
