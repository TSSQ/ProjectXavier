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
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  isUsefulDeviceParse,
  resolveRelativeDate,
  resolveAbsoluteDate,
  applyGroundingGuards,
} from '../../domain/deviceParsePrompt';
import { accountParseSchema } from '../../domain/accountParseSchema';
import {
  buildAccountParseInstructions,
  buildAccountParsePrompt,
  normalizeAccountParseOutput,
  AccountExtraction,
  AccountParseContext,
} from '../../domain/accountParsePrompt';
import { accountUpdateParseSchema } from '../../domain/accountUpdateSchema';
import {
  buildAccountUpdateInstructions,
  buildAccountUpdatePrompt,
  normalizeAccountUpdateOutput,
  AccountUpdateDraftExtraction,
  AccountUpdateParseContext,
} from '../../domain/accountUpdatePrompt';
import {
  queryToolSelectionSchema,
  buildQueryToolSelectionInstructions,
  buildQueryToolSelectionPrompt,
  normalizeQueryToolSelection,
} from '../../domain/queryToolSelection';
import { QueryToolCall } from '../../domain/queryTools';

/** How many times deviceParse will call the model for one text. The binding
 *  creates a fresh LanguageModelSession per call and exposes no prewarm, so the
 *  first structured-output call per process runs cold and often drops fields
 *  (notably the amount). A second, now-warm attempt usually recovers a usable
 *  parse, so we retry once when the first result isn't useful before giving up
 *  to the heuristic tier. */
const MAX_ATTEMPTS = 2;

export interface DeviceParseInput {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** Device clock (ms since epoch) — passed in so the prompt uses the user's
   *  local "now" rather than this module calling Date.now() itself. */
  now: number;
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
  const { object } = await generateObject({
    model: apple(),
    system: buildDeviceParseInstructions(),
    prompt: buildDeviceParsePrompt(text, ctx),
    schema: deviceParseSchema,
  });

  // Reject a hallucinated account or payee (applyGroundingGuards): the small
  // model tends to pick a plausible entry from the grounded lists even when
  // the user named neither.
  const normalized = applyGroundingGuards(normalizeDeviceParseOutput(object), text);
  // The model is unreliable at dates (it returns "today" for both "… yesterday"
  // and "… 24th June"), so prefer a deterministic reading of the user's own
  // words — relative phrases first, then absolute calendar dates — and fall
  // back to the model's occurredOn (already normalized) only when neither
  // resolver recognises a date.
  const textDate = resolveRelativeDate(text, ctx.now) ?? resolveAbsoluteDate(text, ctx.now);
  if (textDate != null) normalized.occurredAt = textDate;
  const validated = aiParsedExpenseSchema.safeParse(normalized);
  return validated.success ? validated.data : null;
}

/**
 * Parse `text` on-device via Apple Foundation Models. Returns the validated
 * `AiParsedExpense` on success, or `null` if the device can't run it,
 * generation fails, or the (normalized) output doesn't pass schema
 * validation — any of which should make the caller fall through to the
 * heuristic tier rather than surface a device-specific error.
 *
 * Retries once (see MAX_ATTEMPTS) when the first attempt throws or comes back
 * unusable, to absorb the binding's cold-start miss on the first call per
 * process. Returns the best result seen — a useful parse as soon as one
 * appears, otherwise the last non-throwing (but weak) parse, otherwise null;
 * the caller's usefulness gate still decides whether to keep it.
 */
export async function deviceParse(
  text: string,
  ctx: DeviceParseInput
): Promise<AiParsedExpense | null> {
  if (!(await isDeviceAiAvailable())) return null;

  let last: AiParsedExpense | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const parsed = await deviceParseUnsafe(text, ctx);
      if (isUsefulDeviceParse(parsed)) return parsed;
      last = parsed ?? last;
    } catch (e) {
      console.warn(`deviceParse attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
    }
  }
  return last;
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
 * Retries up to `MAX_ATTEMPTS` times (same constant `deviceParse` uses) when
 * the first attempt throws or comes back unusable, to absorb the SAME
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
        schema: accountParseSchema,
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
        schema: accountUpdateParseSchema,
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
        schema: queryToolSelectionSchema,
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
