/**
 * BYOK cloud parse engine — Anthropic. Raw `fetch` to `POST /v1/messages`
 * forcing the `record_expense` tool (docs/design/byok-raw-fetch-spec.md) —
 * NOT the Vercel AI SDK's `generateObject`, whose HTTP path depends on
 * web-streams (`ReadableStream`/`TextDecoderStream`/`TransformStream`) that
 * Hermes/React Native does not provide (see memory
 * `byok-generateobject-rn-incompat`; reproduced end-to-end in the iOS 26
 * simulator). Mirrors `src/features/ai/listModels.ts`'s network hygiene: an
 * `AbortController` (via `src/features/ai/engines/shared.ts`'s
 * `CLOUD_REQUEST_TIMEOUT_MS`), never throws out of `anthropicParse` (any
 * failure resolves to `null` via `runCloudParse`), and never logs the key or
 * the request/response body.
 *
 * `fetchAnthropicRaw` is exported (not just used internally) so
 * `src/features/ai/testKey.ts` can reuse the EXACT same request shape for its
 * "Test key" round-trip, rather than maintaining a second, driftable copy.
 */
import { extractAnthropicToolInput } from '../../../domain/cloudParseTransport';
import { CloudParseContext, ParseContract, runCloudParse } from './shared';

export interface AnthropicRawResult {
  /** The real HTTP status code — src/features/ai/testKey.ts classifies on
   *  this; the parse path only cares whether `raw` came back non-null. */
  status: number;
  /** The forced tool call's `input` (the raw, still-untrusted device-parse
   *  object), or `null` for a non-2xx status or a response with no usable
   *  `tool_use` block. */
  raw: unknown | null;
}

/**
 * POST `/v1/messages` with `tool_choice` forcing the given `contract`'s tool
 * — pass `EXPENSE_PARSE_CONTRACT` (today's behavior, unchanged; its tool is
 * `record_expense`) or `ACCOUNT_PARSE_CONTRACT`
 * (docs/design/account-chat-creation-spec.md §5.2), both from ./shared — so
 * a successful response always carries a `tool_use` block shaped like the
 * contract's schema. `contract` is REQUIRED (no default): see
 * `openai.ts`'s `fetchOpenAiRaw` header for why a generic default here would
 * have needed an unsound `as unknown as` cast. Never throws for an expected
 * failure shape (non-2xx status, no `tool_use` block) — those resolve to
 * `raw: null`. A genuine network error or the caller's abort still
 * propagates as a thrown error (left to the caller's own never-throw
 * wrapper).
 */
export async function fetchAnthropicRaw<T>(
  text: string,
  ctx: CloudParseContext,
  apiKey: string,
  modelId: string,
  signal: AbortSignal,
  contract: ParseContract<T>
): Promise<AnthropicRawResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      system: contract.instructions(),
      messages: [{ role: 'user', content: contract.buildPrompt(text, ctx) }],
      tools: [
        {
          name: contract.toolName,
          description: contract.toolDescription,
          input_schema: contract.jsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: contract.toolName },
    }),
    signal,
  });
  if (!res.ok) return { status: res.status, raw: null };
  const json: unknown = await res.json();
  return { status: res.status, raw: extractAnthropicToolInput(json) };
}

/**
 * Parse `text` via the user's own Anthropic key and model.
 *
 * @param apiKey  The user's own Anthropic API key (from Keychain — see
 *   src/features/ai/byokKey.ts — never persisted anywhere else).
 * @param modelId The model to call (e.g. "claude-3-5-haiku-latest",
 *   user-editable in Settings — see DEFAULT_BYOK_MODEL in
 *   src/features/settings/repository.ts).
 * @param contract Which parse contract to run — REQUIRED, no default (see
 *   `fetchAnthropicRaw`'s header for why).
 */
export async function anthropicParse<T>(
  text: string,
  ctx: CloudParseContext,
  apiKey: string,
  modelId: string,
  contract: ParseContract<T>
): Promise<T | null> {
  return runCloudParse<T>(
    async (signal) => (await fetchAnthropicRaw(text, ctx, apiKey, modelId, signal, contract)).raw,
    text,
    ctx,
    'anthropic',
    contract.normalize
  );
}
