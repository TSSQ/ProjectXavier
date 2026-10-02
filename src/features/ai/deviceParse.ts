/**
 * On-device parse tier — Apple Foundation Models via @react-native-ai/apple,
 * driven through the Vercel AI SDK's `generateObject` with a real zod schema
 * (guided generation — the model is constrained to the schema, nullable
 * fields included, rather than the sentinel-value re-encoding the previous
 * react-native-apple-llm binding forced).
 *
 * The default (and only AI) tier in the assistant's parse ladder, ahead of
 * the deterministic heuristic (src/domain/localParse.ts): the app always
 * tries an on-device LLM parse first (private, no network), falling to the
 * heuristic floor only when Foundation Models is unavailable or couldn't
 * produce a usable parse. Requires iOS 26 + an Apple Intelligence-capable
 * device/simulator.
 *
 * The binding is a TurboModule, so this file must never be imported from the
 * framework-free plain-node BDD suite — only from RN screens. The pure
 * prompt/schema/normalization logic it depends on lives in
 * src/domain/deviceParsePrompt.ts, which IS covered there. The AI SDK also
 * needs the polyfills installed by src/lib/aiPolyfills.ts (imported at the
 * top of app/_layout.tsx).
 *
 * The model's output is untrusted input (guardrail #6): even though
 * `generateObject` already validates it against `deviceParseSchema`, it is
 * normalized and then re-validated against `aiParsedExpenseSchema` before
 * this module ever returns it to a caller.
 */
import { generateObject } from 'ai';
import { apple } from '@react-native-ai/apple';
import { aiParsedExpenseSchema, AiParsedExpense } from '../../lib/validation';
import { Category, Payee, Account } from '../../domain/types';
import {
  buildFmParseInstructions,
  buildFmParsePrompt,
  normalizeDeviceParseOutput,
  resolveTypedDate,
  applyGroundingGuards,
} from '../../domain/deviceParsePrompt';
import {
  DEVICE_PARSE_SCHEMA,
  ACCOUNT_CREATE_SCHEMA,
  ACCOUNT_UPDATE_SCHEMA,
  QUERY_TOOL_SELECTION_SCHEMA,
  TRANSACTION_OP_SELECTION_SCHEMA,
} from '../../domain/deviceSchemas';
import { runDeviceParseAttempts } from '../../domain/deviceParseAttempts';
import { classifyDeviceParse, FmParseOutcome } from '../../domain/fmRefusal';
import {
  buildAccountParseInstructions,
  buildAccountParsePrompt,
  normalizeAccountParseOutput,
  AccountExtraction,
  AccountParseContext,
} from '../../domain/accountParsePrompt';
import {
  buildAccountUpdateInstructions,
  buildAccountUpdatePrompt,
  normalizeAccountUpdateOutput,
  AccountUpdateDraftExtraction,
  AccountUpdateParseContext,
} from '../../domain/accountUpdatePrompt';
import {
  buildQueryToolSelectionInstructions,
  buildQueryToolSelectionPrompt,
  normalizeQueryToolSelection,
} from '../../domain/queryToolSelection';
import { QueryToolCall } from '../../domain/queryTools';
import {
  buildTransactionOpInstructions,
  buildTransactionOpPrompt,
  normalizeTransactionOpSelection,
} from '../../domain/transactionOpSelection';

/** How many times each of the OTHER on-device calls below (account/account-
 *  update/query-selection/transaction-op — everything except `deviceParse`
 *  itself, which now uses the shared `DEVICE_PARSE_MAX_ATTEMPTS` via
 *  `runDeviceParseAttempts`, see src/domain/deviceParseAttempts.ts) will call
 *  the model for one input. Same binding cold-start reasoning: the binding
 *  creates a fresh LanguageModelSession per call and exposes no prewarm, so
 *  the first structured-output call per process runs cold and often drops
 *  fields; a second, now-warm attempt usually recovers a usable result. */
const MAX_ATTEMPTS = 2;

export interface DeviceParseInput {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** Device clock (ms since epoch) — passed in so the prompt uses the user's
   *  local "now" rather than this module calling Date.now() itself. */
  now: number;
  /** The app's current single-currency setting (`getCurrency()`) — scales the
   *  model's major-unit amount to minor units at THIS currency's exponent
   *  (review F1 / M7), so a JPY "coffee 500" parses to 500 minor, not 50000.
   *  Defaults to 'USD' (2-decimal) so existing callers are unaffected. */
  currency?: string;
}

/** True only when Foundation Models are ready to run right now (Apple
 *  Intelligence enabled, model available, supported device). Anything else
 *  means the caller should fall through to the next tier. Never throws: a
 *  native-module error is treated the same as "not available". (Async for
 *  caller compatibility even though the underlying check is synchronous.) */
export async function isDeviceAiAvailable(): Promise<boolean> {
  try {
    return apple.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Parse `text` on-device via Apple Foundation Models. Throws on any binding/
 * generation failure and returns `null` only when the model's (normalized)
 * output doesn't survive `aiParsedExpenseSchema`. Exists separately from
 * `deviceParse` so the debug screen (app/debug-fm.tsx) can surface the real
 * error instead of an indistinguishable null.
 */
export async function deviceParseUnsafe(
  text: string,
  ctx: DeviceParseInput
): Promise<AiParsedExpense | null> {
  // `DEVICE_PARSE_SCHEMA` (not a bare zod schema) so the exact JSON Schema
  // sent to the binding carries a pinned "x-order" (step 1a.5 — see
  // src/domain/deviceParseSchemaOrder.ts), which the patched native parser
  // (patches/@react-native-ai+apple+*.patch) honours to build the model's
  // fields in a fixed order instead of Swift's per-call-randomized
  // Dictionary order. It's built (src/domain/deviceSchemas.ts) from the SAME
  // `zodSchema()` call `generateObject` would otherwise run internally, so
  // nothing else about the schema changes, and it carries the SAME
  // `validate` that call would otherwise run — `jsonSchema`'s own contract:
  // with no `validate`, `generateObject` would skip validation entirely (see
  // `@ai-sdk/provider-utils`'s `safeValidateTypes`) — so this is what keeps
  // guardrail #6 (AI output is untrusted) and `generateObject`'s existing
  // "throw on schema mismatch" behaviour both intact.
  const { object } = await generateObject({
    model: apple(),
    system: buildFmParseInstructions(),
    prompt: buildFmParsePrompt(text, ctx),
    schema: DEVICE_PARSE_SCHEMA,
  });

  // Reject a hallucinated account or payee (applyGroundingGuards): the small
  // model tends to pick a plausible entry from the grounded lists even when
  // the user named neither.
  const currency = ctx.currency ?? 'USD';
  const normalized = applyGroundingGuards(
    normalizeDeviceParseOutput(object, currency),
    text,
    currency
  );
  // The date is ALWAYS the user's own words, else today — never the model's
  // occurredOn. The small model has never been reliable at dates, and on
  // iOS 27 it dates undated text ("coffee 4.80") YESTERDAY (see
  // resolveTypedDate).
  normalized.occurredAt = resolveTypedDate(text, ctx.now) ?? ctx.now;
  const validated = aiParsedExpenseSchema.safeParse(normalized);
  return validated.success ? validated.data : null;
}

/**
 * Parse `text` on-device via Apple Foundation Models. Returns a distinct
 * outcome (src/domain/fmRefusal.ts) instead of overloading `null`:
 *  - `parsed`  — a usable, schema-validated parse;
 *  - `refused` — the model answered with a valid result that has no usable
 *    amount (its "not a transaction" sentinel); the caller must NOT silently
 *    fall back to the heuristic;
 *  - `failed`  — device can't run it, every attempt threw, or the output
 *    never survived schema validation; the caller falls through to the
 *    heuristic tier as before.
 *
 * The retry loop itself is `runDeviceParseAttempts`
 * (src/domain/deviceParseAttempts.ts, review B1/S1) — shared verbatim with
 * the eval harness's on-device probe runner (`runFM` in
 * evals/engines/run_node.mjs), so the two can never hand-drift apart. It is
 * unchanged; the outcome is classified from the `parse` it settles on.
 */
export async function deviceParse(
  text: string,
  ctx: DeviceParseInput
): Promise<FmParseOutcome> {
  if (!(await isDeviceAiAvailable())) return { kind: 'failed' };

  // `attemptNo`/`maxAttempts` come straight from `runDeviceParseAttempts`
  // (review N6) rather than being re-derived here via `hasAmountEvidence`/
  // `DEVICE_PARSE_MAX_ATTEMPTS` — the retry loop is the one place that
  // actually resolves the cap, so this log line can't silently drift from it.
  const { parse } = await runDeviceParseAttempts(text, async (attemptNo, maxAttempts) => {
    try {
      return await deviceParseUnsafe(text, ctx);
    } catch (e) {
      console.warn(`deviceParse attempt ${attemptNo}/${maxAttempts} failed:`, e);
      throw e;
    }
  });
  return classifyDeviceParse(parse);
}

/** An account extraction is "useful" the same way an expense parse is (see
 *  `isUsefulDeviceParse`): a schema-valid-but-empty result — the model
 *  contributed neither a name nor a resolvable subtype — is exactly the
 *  cold-start failure mode `MAX_ATTEMPTS` exists to absorb, so it's worth one
 *  more try before falling through to the next engine/the deterministic
 *  floor. `subtype !== 'unknown'` already covers the case where the gate's
 *  own `subtypeHint` resolved it (normalizeAccountParseOutput's fallback),
 *  which still counts as useful. */
function isUsefulAccountExtraction(e: AccountExtraction | null): boolean {
  return e != null && (e.name != null || e.subtype !== 'unknown');
}

/**
 * Extract {name, subtype} on-device via Apple Foundation Models, for
 * chat-driven account creation (docs/design/account-chat-creation-spec.md
 * §5.2/§5.4) — a second, schema-generic `generateObject` call alongside the
 * expense one above, sharing the same binding but the account contract's own
 * schema/instructions/prompt/normalize (src/domain/accountParsePrompt.ts).
 *
 * Retries up to its own local `MAX_ATTEMPTS` (this module's top-level
 * constant, above — deliberately NOT the shared `DEVICE_PARSE_MAX_ATTEMPTS`/
 * `runDeviceParseAttempts` helper `deviceParse` uses; this call, along with
 * `deviceParseAccountUpdate`/`deviceParseQuerySelection`/
 * `deviceParseTransactionOp` below, intentionally keeps its own simple retry
 * loop out of scope for that refactor — see `MAX_ATTEMPTS`'s own doc comment)
 * when the first attempt throws or comes back unusable, to absorb the SAME
 * binding cold-start miss on the first structured-output call per process —
 * a first-message account creation is exactly the scenario most likely to
 * hit a cold session, so this can't skip the retry just because the account
 * contract itself is simpler. Returns the best result seen — a useful
 * extraction as soon as one appears, otherwise the last non-throwing (but
 * empty) extraction, otherwise `null`.
 */
export async function deviceParseAccount(
  text: string,
  ctx: AccountParseContext
): Promise<AccountExtraction | null> {
  if (!(await isDeviceAiAvailable())) return null;

  let last: AccountExtraction | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: apple(),
        system: buildAccountParseInstructions(),
        prompt: buildAccountParsePrompt(text, ctx),
        // Pinned to the schema's own declaration order (review B1): without
        // an explicit "x-order", the patched native parser (step 1a.5) falls
        // back to alphabetical order, the reverse of what this contract's
        // prompt was authored/probed against. Built in src/domain/
        // deviceSchemas.ts, imported by name — never a bare zod schema.
        schema: ACCOUNT_CREATE_SCHEMA,
      });
      const parsed = normalizeAccountParseOutput(
        object as Record<string, unknown>,
        text,
        ctx.subtypeHint
      );
      if (isUsefulAccountExtraction(parsed)) return parsed;
      last = parsed;
    } catch (e) {
      console.warn(`deviceParseAccount attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
    }
  }
  return last;
}

/** An update extraction is "useful" the same way — a schema-valid-but-empty
 *  result (no target, no operation, no new name, no new subtype) is the
 *  cold-start failure mode worth one more try. A model guardrail refusal
 *  (the probe's ~14% FM false-positive rate, spec §6.1) throws and is caught
 *  by the retry loop below the same way any other generation failure is —
 *  after MAX_ATTEMPTS it falls through to `null`, and the chat flow's
 *  deterministic path (findAccountMatch + verb-based op) takes over. */
function isUsefulAccountUpdateExtraction(e: AccountUpdateDraftExtraction | null): boolean {
  return (
    e != null &&
    (e.targetName != null || e.operation !== 'unknown' || e.newName != null || e.newSubtype !== 'unknown')
  );
}

/**
 * Extract {targetName, operation, newName, newSubtype} on-device via Apple
 * Foundation Models, for chat-driven account UPDATE (docs/design/account-
 * chat-crud-spec.md §5.2) — mirrors `deviceParseAccount` exactly, just with
 * the update contract's own schema/instructions/prompt/normalize
 * (src/domain/accountUpdatePrompt.ts). A refusal/failure here is expected
 * and handled by the caller falling back to the fully deterministic path —
 * the model is never load-bearing for this flow.
 */
export async function deviceParseAccountUpdate(
  text: string,
  ctx: AccountUpdateParseContext
): Promise<AccountUpdateDraftExtraction | null> {
  if (!(await isDeviceAiAvailable())) return null;

  let last: AccountUpdateDraftExtraction | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: apple(),
        system: buildAccountUpdateInstructions(),
        prompt: buildAccountUpdatePrompt(text, ctx),
        // Pinned to declaration order — see deviceParseAccount's identical
        // comment above (review B1). Built in src/domain/deviceSchemas.ts.
        schema: ACCOUNT_UPDATE_SCHEMA,
      });
      const parsed = normalizeAccountUpdateOutput(
        object as Record<string, unknown>,
        text,
        ctx.subtypeHint
      );
      if (isUsefulAccountUpdateExtraction(parsed)) return parsed;
      last = parsed;
    } catch (e) {
      console.warn(`deviceParseAccountUpdate attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
    }
  }
  return last;
}

/**
 * Single-shot tool SELECTION on-device via Apple Foundation Models
 * (docs/design/ask-xavier-queries-spec.md §5.3) — one `generateObject` call
 * against `queryToolSelectionSchema`, normalized into a `QueryToolCall` (or
 * `null` when the model refused, picked "none", or named an unrecognised
 * tool). Unlike the expense/account contracts, a "no usable result" retry
 * doesn't apply the same way here: there's no meaningful partial selection to
 * prefer over another, so this simply retries up to `MAX_ATTEMPTS` times
 * (the same cold-start-session absorption every other on-device call needs)
 * and returns the first non-null normalized selection, or `null` if every
 * attempt came back unusable.
 */
export async function deviceParseQuerySelection(text: string): Promise<QueryToolCall | null> {
  if (!(await isDeviceAiAvailable())) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: apple(),
        system: buildQueryToolSelectionInstructions(),
        prompt: buildQueryToolSelectionPrompt(text),
        // Pinned to declaration order — see deviceParseAccount's identical
        // comment above (review B1). Built in src/domain/deviceSchemas.ts.
        schema: QUERY_TOOL_SELECTION_SCHEMA,
      });
      const call = normalizeQueryToolSelection(object as Record<string, unknown>);
      if (call) return call;
    } catch (e) {
      // Key/content-free, matching the BYOK loop's hygiene rule — only the
      // error's constructor name reaches the console, never model output.
      const label = e instanceof Error ? e.constructor.name : 'unknown error';
      console.warn(`deviceParseQuerySelection attempt ${attempt}/${MAX_ATTEMPTS} failed:`, label);
    }
  }
  return null;
}

/**
 * Single-shot transaction-op SELECTION on-device via Apple Foundation Models
 * (docs/design/chat-transaction-delete-update-spec.md §5.2) — one
 * `generateObject` call against `transactionOpSelectionSchema`, normalized
 * into `'delete' | 'update' | null` (null on refusal, "none", or an
 * unrecognised value). Copies `deviceParseQuerySelection`'s exact shape: no
 * meaningful partial result to prefer over another, so this simply retries
 * up to `MAX_ATTEMPTS` times (the same cold-start-session absorption every
 * other on-device call needs) and returns the first non-null normalized
 * selection, or `null` if every attempt came back unusable — the caller
 * falls back to the deterministic verb-category floor (spec §5.2 "floor
 * behaviour") rather than treating this as an error.
 */
export async function deviceParseTransactionOp(text: string): Promise<'delete' | 'update' | null> {
  if (!(await isDeviceAiAvailable())) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: apple(),
        system: buildTransactionOpInstructions(),
        prompt: buildTransactionOpPrompt(text),
        // Pinned to declaration order — see deviceParseAccount's identical
        // comment above (review B1). Built in src/domain/deviceSchemas.ts.
        schema: TRANSACTION_OP_SELECTION_SCHEMA,
      });
      const op = normalizeTransactionOpSelection(object as Record<string, unknown>);
      if (op) return op;
    } catch (e) {
      const label = e instanceof Error ? e.constructor.name : 'unknown error';
      console.warn(`deviceParseTransactionOp attempt ${attempt}/${MAX_ATTEMPTS} failed:`, label);
    }
  }
  return null;
}
