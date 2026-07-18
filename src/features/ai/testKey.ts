/**
 * BYOK "Test key" round-trip (docs/design/byok-spec.md item 5) — a cheap,
 * fixed-sample raw-fetch call the Settings screen (app/settings/byok.tsx)
 * runs on demand to surface a bad paste immediately. Does NOT gate saving the
 * key, and never prompts for biometrics (that would make every future parse
 * miserable — see src/lib/secureStore.ts's `WHEN_UNLOCKED_THIS_DEVICE_ONLY`,
 * which already means the key is unreadable while the device itself is
 * locked).
 *
 * Reuses `src/features/ai/engines/anthropic.ts`'s/`openai.ts`'s
 * `fetchAnthropicRaw`/`fetchOpenAiRaw` directly — the EXACT same request
 * shape as the real parse engines (docs/design/byok-raw-fetch-spec.md), so a
 * passing test genuinely proves the key/model combination works for the real
 * parse call, not just an unrelated ping — but classifies the result by the
 * REAL HTTP status so Settings can show a specific hint: `ok`, `invalid` (a
 * 401/403 — bad key), `not_found` (a 404 — the key is fine but the model id
 * isn't, e.g. a typo'd or deprecated id), or `network` (offline, timeout,
 * rate-limited, a 2xx with no usable body, or any other provider error). The
 * pure classification itself lives in src/domain/cloudParseTransport.ts
 * (`classifyTestKeyStatus`) so it's directly unit-testable.
 *
 * "Usable" is gated on the SAME `isRecord` check `runCloudParse`
 * (src/features/ai/engines/shared.ts) uses to decide whether to normalize a
 * raw model object — never just "non-null" — so this can never report `ok`
 * for a response whose raw value isn't even a usable record (e.g. a
 * `tool_use.input` or `json_schema` content that parses to a scalar/array
 * rather than an object), which the real parse also rejects. It does not
 * re-run the downstream schema validation, so agreement holds at the
 * usable-record level, not beyond.
 */
import { ByokProvider } from '../../domain/parseRouter';
import { classifyTestKeyStatus, isRecord, TestKeyResult } from '../../domain/cloudParseTransport';
import { CLOUD_REQUEST_TIMEOUT_MS } from './engines/shared';
import { fetchAnthropicRaw } from './engines/anthropic';
import { fetchOpenAiRaw } from './engines/openai';

export type { TestKeyResult };

/** A fixed, cheap sample — a real (if generic) expense utterance so the test
 *  exercises the actual parse contract rather than an unrelated ping. */
const TEST_SAMPLE_TEXT = 'coffee 5';

function testContext() {
  return { categories: [], payees: [], accounts: [], now: Date.now() };
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
    const { status, raw } =
      provider === 'openai'
        ? await fetchOpenAiRaw(TEST_SAMPLE_TEXT, testContext(), apiKey, modelId, controller.signal)
        : await fetchAnthropicRaw(
            TEST_SAMPLE_TEXT,
            testContext(),
            apiKey,
            modelId,
            controller.signal
          );
    return classifyTestKeyStatus(status, isRecord(raw));
  } catch {
    // Deliberately key/content-free — see engines/shared.ts's runCloudParse:
    // any network/abort error (offline, timeout) is the generic "try again"
    // bucket, never the key, header, or body.
    return 'network';
  } finally {
    clearTimeout(timer);
  }
}
