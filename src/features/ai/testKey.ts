/**
 * BYOK "Test key" round-trip (docs/design/byok-spec.md item 5) — a cheap,
 * fixed-sample `generateObject` call the Settings screen (app/settings/byok.tsx)
 * runs on demand to surface a bad paste immediately. Does NOT gate saving the
 * key, and never prompts for biometrics (that would make every future parse
 * miserable — see src/lib/secureStore.ts's `WHEN_UNLOCKED_THIS_DEVICE_ONLY`,
 * which already means the key is unreadable while the device itself is
 * locked).
 *
 * Reuses the exact same prompt/schema contract as the real engines
 * (src/features/ai/engines/shared.ts) so a passing test genuinely proves the
 * key/model combination works for the real parse call, not just an unrelated
 * ping — but classifies the result into four outcomes so Settings can show a
 * specific hint: `ok`, `invalid` (bad key — a 401/403 from the provider),
 * `not_found` (a 404 — the key is fine but the model id isn't, e.g. a typo'd
 * or deprecated id), or `network` (offline, timeout, rate-limited, or any
 * other provider error).
 */
import { generateObject, APICallError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ByokProvider } from '../../domain/parseRouter';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
} from '../../domain/deviceParsePrompt';
import { CLOUD_REQUEST_TIMEOUT_MS } from './engines/shared';

export type TestKeyResult = 'ok' | 'invalid' | 'not_found' | 'network';

/** A fixed, cheap sample — a real (if generic) expense utterance so the test
 *  exercises the actual parse contract rather than an unrelated ping. */
const TEST_SAMPLE_TEXT = 'coffee 5';

function modelFor(provider: ByokProvider, apiKey: string, modelId: string) {
  return provider === 'openai'
    ? createOpenAI({ apiKey })(modelId)
    : createAnthropic({ apiKey })(modelId);
}

/**
 * Round-trip `apiKey`/`modelId` against the real provider. Never throws.
 */
export async function testByokKey(
  provider: ByokProvider,
  apiKey: string,
  modelId: string
): Promise<TestKeyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    await generateObject({
      model: modelFor(provider, apiKey, modelId),
      system: buildDeviceParseInstructions(),
      prompt: buildDeviceParsePrompt(TEST_SAMPLE_TEXT, {
        categories: [],
        payees: [],
        accounts: [],
        now: Date.now(),
      }),
      schema: deviceParseSchema,
      abortSignal: controller.signal,
    });
    return 'ok';
  } catch (e) {
    // Deliberately key/content-free — see engines/shared.ts's runCloudParse:
    // only the status code (never the key, header, or body) drives the
    // classification below.
    if (APICallError.isInstance(e) && (e.statusCode === 401 || e.statusCode === 403)) {
      return 'invalid';
    }
    if (APICallError.isInstance(e) && e.statusCode === 404) {
      return 'not_found';
    }
    return 'network';
  } finally {
    clearTimeout(timer);
  }
}
