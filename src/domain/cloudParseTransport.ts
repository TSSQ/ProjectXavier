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
import type { ByokProvider } from './parseRouter';

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
 * Anthropic `/v1/messages` response (forced `tool_choice: record_expense`,
 * the `forced_tool` mode — see byokSampling.ts `anthropicOutputMode`)
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
 * Anthropic `/v1/messages` response to an `output_config.format` json_schema
 * request (`anthropicOutputMode` → `structured_output`) -> the JSON object in
 * its first `text` block, or `null` when there is none, the text isn't JSON,
 * the JSON isn't a record, or the model stopped early (`refusal`,
 * `max_tokens`: the output need not match the schema then). Thinking blocks
 * may come first; only the text block carries the output.
 */
export function extractAnthropicStructuredOutput(response: unknown): unknown | null {
  if (!isRecord(response) || !Array.isArray(response.content)) return null;
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const block = response.content.find((b) => isRecord(b) && b.type === 'text');
  if (!isRecord(block) || typeof block.text !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(block.text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keywords Anthropic's structured outputs reject with a 400 (numeric and
 *  string-length constraints) or that are not schema content (`$schema`). */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
]);

/**
 * A contract's JSON Schema made acceptable to `output_config.format`: every
 * object gets `additionalProperties: false` (required there), and the
 * keywords above are dropped (the contract's own normalize/zod step still
 * enforces whatever they meant — the model output is untrusted anyway).
 * Never mutates the input.
 */
export function anthropicStructuredOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(k)) continue;
      if (k === 'properties' && isRecord(v)) {
        out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, visit(sub)]));
      } else if (k === 'enum' || k === 'const' || k === 'required' || k === 'description') {
        out[k] = v;
      } else {
        out[k] = visit(v);
      }
    }
    if (out.type === 'object') out.additionalProperties = false;
    return out;
  };
  return visit(schema) as Record<string, unknown>;
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

// ─── cloud parse failure classification ────────────────────────────────────

/**
 * Why a BYOK cloud parse produced nothing — a small, fixed, key-free enum the
 * engines (src/features/ai/engines/shared.ts's `runCloudParse`) return instead
 * of a bare `null`, so the chat screen can tell the user their key didn't
 * answer (and roughly why) when a later engine serves the draft, and the
 * parse-metrics row can carry the reason (docs/design/parse-metrics-spec.md).
 * Nothing here is derived from the request/response BODY — only from the
 * HTTP status, the thrown error's kind, or the fact that extraction/validation
 * failed. `auth`: 401/403 (bad or revoked key); `not_found`: 404 (bad model
 * id); `rate_limited`: 429 (quota, billing, or burst limit); `rejected`: any
 * other 4xx — the provider refused the request itself, almost always because
 * the picked model doesn't accept something in it (`temperature`,
 * `json_schema`, a forced `tool_choice`), so the fix is another model, not a
 * retry; `network`: abort/timeout, a transport error, or a 5xx/other
 * non-2xx status; `bad_output`: a 2xx whose body wasn't JSON, yielded no
 * usable record, or failed the contract's normalize/validate step.
 */
export type CloudParseFailure =
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'rejected'
  | 'network'
  | 'bad_output';

/**
 * Classify a BYOK parse by its REAL HTTP status: `null` for a 2xx (the body
 * decides from there), else the matching `CloudParseFailure`. Mirrors
 * `classifyTestKeyStatus` above (401/403 -> auth, 404 -> not_found) but keeps
 * 429 apart as `rate_limited` — for the parse path "try again later" and
 * "your key is dead" are different user messages — and every other 4xx apart
 * as `rejected` ("pick another model"), so a 400 is never reported as a lost
 * connection.
 */
export function classifyCloudParseStatus(status: number): CloudParseFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'rejected';
  return 'network';
}

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const FAILURE_PHRASE: Record<Exclude<CloudParseFailure, 'rejected'>, string> = {
  auth: 'invalid key',
  not_found: 'model not found',
  rate_limited: 'rate limited',
  network: 'no connection or timed out',
  bad_output: 'unusable reply',
};

/**
 * The one-line draft-card notice shown when the user's BYOK provider failed
 * and a later engine served the draft, e.g. "Your OpenAI key didn't answer
 * (invalid key); parsed on-device instead." `servedBy` is which engine took
 * over: the on-device model, or the deterministic heuristic (whose line also
 * carries the "check it before saving" nudge the basic parser always gets —
 * see src/components/assistant/DraftCard.tsx). `rejected` says what to do
 * instead of why: the key answered, the picked model refused the request
 * ("Your OpenAI model rejected the request; try another model in Settings.").
 */
export function cloudFallbackNotice(
  provider: ByokProvider,
  reason: CloudParseFailure,
  servedBy: 'on_device' | 'heuristic'
): string {
  const label = PROVIDER_LABEL[provider];
  if (reason === 'rejected') {
    const head = `Your ${label} model rejected the request; try another model in Settings.`;
    return servedBy === 'on_device'
      ? `${head} Parsed on-device instead.`
      : `${head} This used basic parsing instead — check it before saving.`;
  }
  const head = `Your ${label} key didn't answer (${FAILURE_PHRASE[reason]});`;
  return servedBy === 'on_device'
    ? `${head} parsed on-device instead.`
    : `${head} this used basic parsing instead — check it before saving.`;
}
