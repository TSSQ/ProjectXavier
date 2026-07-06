/**
 * On-device parse tier — Apple Foundation Models via @react-native-ai/apple,
 * driven through the Vercel AI SDK's `generateObject` with a real zod schema
 * (guided generation — the model is constrained to the schema, nullable
 * fields included, rather than the sentinel-value re-encoding the previous
 * react-native-apple-llm binding forced).
 *
 * Sits between the cloud AI proxy and the deterministic heuristic
 * (src/domain/localParse.ts) in the assistant's fallback ladder: when the
 * cloud proxy is unreachable/quota-exhausted, the app tries an on-device LLM
 * parse (privacy-friendly, no network) before dropping to the heuristic
 * floor. Requires iOS 26 + an Apple Intelligence-capable device/simulator.
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
 * normalized and then re-validated against `aiParsedExpenseSchema` — the same
 * schema the cloud client validates against — before this module ever
 * returns it to a caller.
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
} from '../../domain/deviceParsePrompt';

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

  const normalized = normalizeDeviceParseOutput(object);
  // The model is unreliable at dates (it returns "today" for "… yesterday"),
  // so prefer a deterministic reading of the user's own words for relative
  // phrases; fall back to the model's occurredOn (already normalized) only when
  // no phrase is recognised.
  const relativeDate = resolveRelativeDate(text, ctx.now);
  if (relativeDate != null) normalized.occurredAt = relativeDate;
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
