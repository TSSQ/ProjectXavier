/**
 * Shared BYOK cloud-engine internals — the exact `generateObject` call shape
 * `src/features/ai/deviceParse.ts`'s `deviceParseUnsafe` uses for Apple
 * Foundation Models (same `buildDeviceParseInstructions` /
 * `buildDeviceParsePrompt` / `deviceParseSchema` / `normalizeDeviceParseOutput`
 * / `applyGroundingGuards` from `src/domain/deviceParsePrompt.ts`, re-validated
 * with `aiParsedExpenseSchema`), only the `model:` differs per provider. Kept
 * in one place so `openai.ts`/`anthropic.ts` can't drift apart — mirrors
 * `evals/engines/run_node.mjs`'s `runGenerateObjectEngine`, which already
 * proved this exact call path against both providers.
 *
 * Network hygiene (docs/design/byok-spec.md): every call carries an
 * AbortController timeout, and ANY failure (bad key, offline, timeout, rate
 * limit, or output that fails re-validation) resolves to `null` rather than
 * throwing — the caller (src/domain/parseRouter.ts's ordering, driven from
 * app/(tabs)/index.tsx) always has a safe fallback to Foundation Models / the
 * heuristic. The key, the Authorization/x-api-key header, and raw request/
 * response content are NEVER logged — only a generic, key-free label reaches
 * `console.warn`.
 */
import { generateObject, LanguageModel } from 'ai';
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
 * Run the shared generateObject parse contract against `model`, returning a
 * validated `AiParsedExpense` on success or `null` on ANY failure — a
 * network/timeout/abort error, a 401/429 provider error, or output that
 * doesn't survive `aiParsedExpenseSchema`. Never throws.
 */
export async function runCloudParse(
  model: LanguageModel,
  text: string,
  ctx: CloudParseContext,
  engineLabel: string
): Promise<AiParsedExpense | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model,
      system: buildDeviceParseInstructions(),
      prompt: buildDeviceParsePrompt(text, ctx),
      schema: deviceParseSchema,
      abortSignal: controller.signal,
    });

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
    // "AbortError", "APICallError") ever reaches the console — never the
    // key, the Authorization/x-api-key header, or the request/response body.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn(`${engineLabel} parse failed:`, label);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
