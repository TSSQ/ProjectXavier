/**
 * Pure, framework-free response-shape handling for the BYOK raw-fetch cloud
 * engines (docs/design/byok-raw-fetch-spec.md) — given an already-`JSON.parse`d
 * provider response body, pull out the raw structured-output object the rest
 * of the pipeline (src/features/ai/engines/shared.ts's runCloudParse)
 * normalizes/guards/validates. NEVER throws: any unexpected shape (missing
 * `tool_use` block, a `content` string that isn't valid JSON, a payload
 * that's the wrong type entirely) resolves to `null`, mirroring
 * `deviceParsePrompt.ts`'s normalize functions. Only the actual `fetch` call
 * lives in the feature layer (src/features/ai/engines/*.ts) so this module
 * stays testable in the plain-Node BDD suite (tests/).
 */

/**
 * True when `v` is a plain JSON object — the ONE gate for "is this raw model
 * output usable" shared by every consumer that must agree on the answer
 * (QA follow-up on docs/design/byok-raw-fetch-spec.md): `runCloudParse`
 * (src/features/ai/engines/shared.ts) gates normalization on this, and
 * `testByokKey` (src/features/ai/testKey.ts) gates its `ok` classification
 * on the SAME check — so Test-key can never report `ok` for a raw value that
 * isn't even a usable record (a scalar or array), which the real parse also
 * rejects outright. (Test-key stops here; it does NOT re-run the downstream
 * `aiParsedExpenseSchema.safeParse` that `runCloudParse` applies afterward, so
 * the two agree at the usable-record level, not beyond it.) Arrays are
 * technically `typeof 'object'` in JS but are never a usable device-parse
 * object, so they're explicitly excluded.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Anthropic `/v1/messages` response (forced `tool_choice: record_expense`)
 * -> the tool call's `input` (the raw, still-untrusted device-parse object),
 * or `null` when the model didn't return a usable `tool_use` block (it
 * refused, returned plain text, the payload isn't even the expected shape,
 * or `input` itself isn't a record — e.g. a scalar or array).
 */
export function extractAnthropicToolInput(response: unknown): unknown | null {
  if (!isRecord(response) || !Array.isArray(response.content)) return null;
  const block = response.content.find((b) => isRecord(b) && b.type === 'tool_use');
  if (!isRecord(block) || !('input' in block)) return null;
  return isRecord(block.input) ? block.input : null;
}

/**
 * OpenAI `/v1/chat/completions` response (`response_format: json_schema`) ->
 * the parsed `choices[0].message.content` JSON, or `null` when the shape is
 * missing, `content` isn't valid JSON, or the parsed JSON isn't a record
 * (e.g. it parses to a bare number, string, or array).
 */
export function extractOpenAiJsonContent(response: unknown): unknown | null {
  if (!isRecord(response) || !Array.isArray(response.choices)) return null;
  const first = response.choices[0];
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── testKey status classification ─────────────────────────────────────────

/** Result of a BYOK "Test key" round-trip (src/features/ai/testKey.ts) —
 *  `ok`: usable; `invalid`: bad key (401/403); `not_found`: bad model id
 *  (404); `network`: offline, timed out, rate-limited, or any other
 *  provider/transport failure. */
export type TestKeyResult = 'ok' | 'invalid' | 'not_found' | 'network';

/**
 * Classify a BYOK test-key round trip by the REAL HTTP status
 * (docs/design/byok-raw-fetch-spec.md): 401/403 (bad key) -> `invalid`, 404
 * (bad model id) -> `not_found`; otherwise `ok` only when the status is
 * ITSELF a success (2xx) AND the call yielded a usable parsed body
 * (`hasUsableBody`, per `isRecord` above) — `hasUsableBody` is never enough
 * on its own, so a non-2xx status (429, 5xx, ...) always falls into the
 * generic `network` "try again" bucket even if a body happened to parse.
 */
export function classifyTestKeyStatus(status: number, hasUsableBody: boolean): TestKeyResult {
  if (status === 401 || status === 403) return 'invalid';
  if (status === 404) return 'not_found';
  const isSuccessStatus = status >= 200 && status < 300;
  return isSuccessStatus && hasUsableBody ? 'ok' : 'network';
}
