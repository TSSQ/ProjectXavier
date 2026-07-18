/**
 * BYOK cloud parse engine — OpenAI. Raw `fetch` to
 * `POST /v1/chat/completions` with `response_format: json_schema`
 * (docs/design/byok-raw-fetch-spec.md) — NOT the Vercel AI SDK's
 * `generateObject`, whose HTTP path depends on web-streams
 * (`ReadableStream`/`TextDecoderStream`/`TransformStream`) that Hermes/React
 * Native does not provide (see memory `byok-generateobject-rn-incompat`;
 * reproduced end-to-end in the iOS 26 simulator). Mirrors
 * `src/features/ai/listModels.ts`'s network hygiene: an `AbortController`
 * (via `src/features/ai/engines/shared.ts`'s `CLOUD_REQUEST_TIMEOUT_MS`),
 * never throws out of `openaiParse` (any failure resolves to `null` via
 * `runCloudParse`), and never logs the key or the request/response body.
 *
 * `fetchOpenAiRaw` is exported (not just used internally) so
 * `src/features/ai/testKey.ts` can reuse the EXACT same request shape for its
 * "Test key" round-trip, rather than maintaining a second, driftable copy.
 * Uses NON-strict `json_schema` (the schema has optional fields; the real
 * trust boundary is `aiParsedExpenseSchema.safeParse` — guardrail #6).
 */
import {
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
} from '../../../domain/deviceParsePrompt';
import { DEVICE_PARSE_JSON_SCHEMA } from '../../../domain/cloudParseSchema';
import { extractOpenAiJsonContent } from '../../../domain/cloudParseTransport';
import { AiParsedExpense } from '../../../lib/validation';
import { CloudParseContext, runCloudParse } from './shared';

export interface OpenAiRawResult {
  /** The real HTTP status code — src/features/ai/testKey.ts classifies on
   *  this; the parse path only cares whether `raw` came back non-null. */
  status: number;
  /** The parsed `choices[0].message.content` JSON (the raw, still-untrusted
   *  device-parse object), or `null` for a non-2xx status or a `content`
   *  string that isn't valid JSON. */
  raw: unknown | null;
}

/**
 * POST `/v1/chat/completions` with a `json_schema` response format, so a
 * successful response's `message.content` is a JSON string shaped like
 * `deviceParseSchema`. Never throws for an expected failure shape (non-2xx
 * status, unparsable content) — those resolve to `raw: null`. A genuine
 * network error or the caller's abort still propagates as a thrown error
 * (left to the caller's own never-throw wrapper).
 */
export async function fetchOpenAiRaw(
  text: string,
  ctx: CloudParseContext,
  apiKey: string,
  modelId: string,
  signal: AbortSignal
): Promise<OpenAiRawResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: buildDeviceParseInstructions() },
        { role: 'user', content: buildDeviceParsePrompt(text, ctx) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'expense', schema: DEVICE_PARSE_JSON_SCHEMA },
      },
    }),
    signal,
  });
  if (!res.ok) return { status: res.status, raw: null };
  const json: unknown = await res.json();
  return { status: res.status, raw: extractOpenAiJsonContent(json) };
}

/**
 * Parse `text` via the user's own OpenAI key and model.
 *
 * @param apiKey  The user's own OpenAI API key (from Keychain — see
 *   src/features/ai/byokKey.ts — never persisted anywhere else).
 * @param modelId The model to call (e.g. "gpt-4o-mini", user-editable in
 *   Settings — see DEFAULT_BYOK_MODEL in src/features/settings/repository.ts).
 */
export async function openaiParse(
  text: string,
  ctx: CloudParseContext,
  apiKey: string,
  modelId: string
): Promise<AiParsedExpense | null> {
  return runCloudParse(
    async (signal) => (await fetchOpenAiRaw(text, ctx, apiKey, modelId, signal)).raw,
    text,
    ctx,
    'openai'
  );
}
