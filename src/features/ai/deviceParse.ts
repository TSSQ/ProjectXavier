/**
 * On-device parse tier — Apple Foundation Models (react-native-apple-llm).
 *
 * Sits between the cloud AI proxy and the deterministic heuristic
 * (src/domain/localParse.ts) in the assistant's fallback ladder: when the
 * cloud proxy is unreachable/quota-exhausted, the app tries an on-device LLM
 * parse (privacy-friendly, no network) before dropping to the heuristic
 * floor. Requires iOS 26 + an Apple Intelligence-capable device/simulator.
 *
 * The native module throws at import time when it isn't linked (see
 * react-native-apple-llm's src/index.tsx), so this file must never be
 * imported from the framework-free plain-node BDD suite — only from RN
 * screens. The pure prompt/schema/normalization logic it depends on lives in
 * src/domain/deviceParsePrompt.ts, which IS covered there.
 *
 * The model's raw output is untrusted input (guardrail #6): it's normalized
 * (sentinel values -> null) and then re-validated against
 * `aiParsedExpenseSchema` — the same schema the cloud client validates
 * against — before this module ever returns it to a caller.
 */
import {
  AppleLLMSession,
  isFoundationModelsEnabled,
} from 'react-native-apple-llm';
import { aiParsedExpenseSchema, AiParsedExpense } from '../../lib/validation';
import { Category, Payee } from '../../domain/types';
import {
  isDeviceParseAvailable,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  DEVICE_PARSE_STRUCTURE,
} from '../../domain/deviceParsePrompt';

export interface DeviceParseInput {
  categories: Category[];
  payees: Payee[];
  /** Device clock (ms since epoch) — passed in so the prompt uses the user's
   *  local "now" rather than this module calling Date.now() itself. */
  now: number;
}

/** True only when Foundation Models are ready to run right now (Apple
 *  Intelligence enabled, model downloaded, supported device). Any other
 *  state — not enabled, still downloading, unsupported — means the caller
 *  should fall through to the next tier. Never throws: a native-module error
 *  is treated the same as "not available". */
export async function isDeviceAiAvailable(): Promise<boolean> {
  try {
    const state = await isFoundationModelsEnabled();
    return isDeviceParseAvailable(state);
  } catch {
    return false;
  }
}

/**
 * Parse `text` on-device via Apple Foundation Models. Returns the validated
 * `AiParsedExpense` on success, or `null` if the device can't run it, the
 * session fails to configure, generation fails, or the (normalized) output
 * doesn't pass schema validation — any of which should make the caller fall
 * through to the heuristic tier rather than surface a device-specific error.
 */
export async function deviceParse(
  text: string,
  ctx: DeviceParseInput
): Promise<AiParsedExpense | null> {
  if (!(await isDeviceAiAvailable())) return null;

  const session = new AppleLLMSession();
  try {
    const configured = await session.configure({
      instructions: buildDeviceParseInstructions(),
    });
    if (!configured) return null;

    const prompt = buildDeviceParsePrompt(text, ctx);
    const raw = await session.generateStructuredOutput({
      structure: DEVICE_PARSE_STRUCTURE,
      prompt,
    });
    if (!raw || typeof raw !== 'object') return null;

    const normalized = normalizeDeviceParseOutput(raw as Record<string, unknown>);
    const validated = aiParsedExpenseSchema.safeParse(normalized);
    return validated.success ? validated.data : null;
  } catch (e) {
    console.warn('deviceParse failed:', e);
    return null;
  } finally {
    session.dispose();
  }
}
