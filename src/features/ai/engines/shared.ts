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
import { aiParsedExpenseSchema, AiParsedExpense } from '../../../lib/validation';
import { Category, Payee, Account } from '../../../domain/types';
import {
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  resolveRelativeDate,
  resolveAbsoluteDate,
} from '../../../domain/deviceParsePrompt';
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
}

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
 */
export async function runCloudParse(
  fetchRawObject: (signal: AbortSignal) => Promise<unknown>,
  text: string,
  ctx: CloudParseContext,
  engineLabel: string
): Promise<AiParsedExpense | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const object = await fetchRawObject(controller.signal);
    if (!isRecord(object)) return null;

    // Same grounding-guard + deterministic-date-override + re-validation
    // pipeline as deviceParseUnsafe (guardrail #6 — the model's output is
    // untrusted regardless of which provider produced it).
    const normalized = applyGroundingGuards(normalizeDeviceParseOutput(object), text);
    const textDate = resolveRelativeDate(text, ctx.now) ?? resolveAbsoluteDate(text, ctx.now);
    if (textDate != null) normalized.occurredAt = textDate;
    const validated = aiParsedExpenseSchema.safeParse(normalized);
    return validated.success ? validated.data : null;
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
