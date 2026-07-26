# BYOK cloud parse — raw fetch instead of the AI SDK's generateObject

## Objective
Make BYOK actually work on-device. The model picker works (it uses a plain
`fetch`), but Test-key and cloud parse fail with "couldn't reach the provider"
because `@ai-sdk`'s `generateObject` routes through `@ai-sdk/provider-utils`,
which depends on web-streams (`ReadableStream`/`TextDecoderStream`/
`TransformStream`/`getReader`) that Hermes/React Native does not provide. This
was reproduced end-to-end in the iOS 26 simulator (same RN runtime as device):
picker lists all 9 Claude models, Test-key fails every time. See memory
`byok-generateobject-rn-incompat`.

Replace the two HTTP providers' `generateObject` calls with a direct `fetch`
to the providers' REST APIs — the exact transport that already works for
`src/features/ai/listModels.ts` — keeping the identical prompt contract,
output normalization, grounding guards, and zod validation.

## HARD CONSTRAINT — never affect the App Store version
- ALL work on branch `claude/phase2-byok` in worktree `.claude/worktrees/fm-spike`.
- NEVER commit/push to `main`. `main` holds build 42 (the App Store binary) and
  must not change. Do not merge, FF, or cherry-pick to main.
- No change to `deviceParse.ts` (on-device Foundation Models via the native
  `apple()` provider — it works because it's a native bridge, not HTTP; leave it
  on `generateObject`).

## Scope
IN:
- `src/features/ai/engines/anthropic.ts` + `src/features/ai/engines/openai.ts`
  + `src/features/ai/engines/shared.ts`: replace the `generateObject` call with
  a raw `fetch` to the provider REST API that returns the raw model object,
  then run it through the EXISTING post-processing (unchanged).
- `src/features/ai/testKey.ts`: replace `generateObject` with the same raw-fetch
  call; classify by the REAL HTTP status.
- Move `@ai-sdk/anthropic` + `@ai-sdk/openai` from `dependencies` to
  `devDependencies` **iff** no app-runtime (`src/**`, `app/**`) import of them
  remains after the migration (the eval harness `evals/engines/run_node.mjs`
  keeps using them in Node — devDeps are installed there). `ai` STAYS in
  `dependencies` (deviceParse.ts still needs `generateObject` + the native
  `apple()` provider).

OUT (explicitly not this ship):
- Tool use / function calling / agentic loops / charts (separate future effort;
  product + privacy decisions still open — see the /discuss).
- Any change to `parseRouter.ts`, `listModels.ts`, the model picker, the prompt
  builders, `deviceParseSchema`, or `aiParsedExpenseSchema`.
- Streaming/token-by-token UX (not needed; parse is one request/response).
- Anything touching `main`, build 42, or the App Store submission.

## Approach (concrete)

### Shared post-processing stays identical
`shared.ts` currently: `generateObject(...)` → `applyGroundingGuards(
normalizeDeviceParseOutput(object), text)` → deterministic date override →
`aiParsedExpenseSchema.safeParse`. Keep ALL of that. Only the step that produces
the raw `object` changes from `generateObject` to a raw fetch. Factor the raw
fetch as a provider-specific function that returns `unknown` (the raw model
object) or throws; `shared.ts` keeps owning normalize/guard/validate and the
never-throw/`null`-on-failure contract.

### Structured-output JSON Schema
The providers need a JSON Schema for `deviceParseSchema`. zod is 3.25 (no native
`z.toJSONSchema` on the v3 API used here) and `zod-to-json-schema` is NOT
installed. Prefer, in order:
1. Reuse a zod→JSON-Schema converter already transitively present in
   `node_modules` (check `@ai-sdk/provider-utils`), if it can be imported
   cleanly, OR
2. Hand-author a `DEVICE_PARSE_JSON_SCHEMA` constant in a shared module that
   mirrors `deviceParseSchema` field-for-field (types, enum values, which are
   optional, and the `.describe()` strings as `description`s), and add a Node
   test asserting it stays in sync with `deviceParseSchema` (same property
   keys, same `type` enum values, same required/optional split) so drift fails
   CI.
Do NOT add a new runtime dependency.

### Anthropic — POST /v1/messages, forced tool_use
```
POST https://api.anthropic.com/v1/messages
headers: x-api-key: <key>, anthropic-version: 2023-06-01, content-type: application/json
body: { model, max_tokens: 1024, system: buildDeviceParseInstructions(),
        messages: [{ role: 'user', content: buildDeviceParsePrompt(text, ctx) }],
        tools: [{ name: 'record_expense', description: '...',
                  input_schema: DEVICE_PARSE_JSON_SCHEMA }],
        tool_choice: { type: 'tool', name: 'record_expense' } }
```
Raw object = `response.content.find(b => b.type === 'tool_use').input`.

### OpenAI — POST /v1/chat/completions, json_schema response
```
POST https://api.openai.com/v1/chat/completions
headers: Authorization: Bearer <key>, content-type: application/json
body: { model, messages: [{ role:'system', content: buildDeviceParseInstructions() },
                           { role:'user', content: buildDeviceParsePrompt(text, ctx) }],
        response_format: { type:'json_schema',
                           json_schema: { name:'expense', schema: DEVICE_PARSE_JSON_SCHEMA } } }
```
Raw object = `JSON.parse(response.choices[0].message.content)`. Use non-strict
json_schema (the schema has optional fields; the real trust boundary is the
existing `aiParsedExpenseSchema.safeParse`, guardrail #6). If a model rejects
json_schema, that surfaces as a normal non-OK status → `null`/`network`, same as
any other failure.

### Network hygiene (unchanged contract, now hand-rolled)
- `AbortController` with `CLOUD_REQUEST_TIMEOUT_MS` (15s) — keep the export.
- NEVER throw out of the engine — any failure (non-OK status, JSON parse fail,
  missing tool_use block, timeout, schema-invalid) resolves to `null` so
  `parseRouter` falls back to Foundation Models / heuristic.
- NEVER log the key, the `x-api-key`/`Authorization` header, or the request/
  response body — only a generic key-free label to `console.warn`, exactly as
  today (`e.constructor.name` style).

### testKey with real status
`testByokKey(provider, apiKey, modelId)` does the same raw fetch with the fixed
sample `'coffee 5'` and classifies by HTTP status:
- 401 / 403 → `invalid`
- 404 → `not_found`  (bad model id)
- 2xx (and a usable body) → `ok`
- anything else (429, 5xx, network error, timeout) → `network`
Keep `TestKeyResult = 'ok' | 'invalid' | 'not_found' | 'network'` and the
existing Settings copy. (429-as-quota is a nice-to-have, out of scope here.)

## Acceptance criteria
1. With a valid Anthropic key + a valid model, Test-key returns `ok` and a real
   parse of "coffee 5" yields amount 500 (cents), type expense — verified in the
   iOS simulator (main agent will do this after the pipeline).
2. Same for OpenAI (verified in Node against a real key via the eval harness if a
   key is available; sim if not).
3. A bad model id → `not_found`; a bad key → `invalid`; offline → `network`.
4. On any provider failure, entry still works: the app falls back to on-device/
   heuristic parsing (no user-facing crash or dead-end).
5. No app-runtime import of `@ai-sdk/anthropic` or `@ai-sdk/openai` remains
   (`grep` in `src/**` + `app/**` is clean); they are moved to `devDependencies`;
   `ai` remains a runtime dep (deviceParse.ts).
6. The key / auth header / request+response body are never logged or thrown.
7. `npm run typecheck && npm run lint && npm test` all green; new Node tests
   cover: the two response parsers (a sample Anthropic `tool_use` response and an
   OpenAI `json_schema` response → expected raw object), the JSON-schema/zod
   parity check, and the testKey status classification.
8. `main` is untouched; the diff is entirely on `claude/phase2-byok`.

## Constraints
- Guardrail #5 (no key/PII logging), #6 (validate the untrusted model output —
  the existing `aiParsedExpenseSchema.safeParse` is the gate; keep it).
- Domain/parse logic stays framework-free where it already is; the raw-fetch
  engines are feature-layer I/O (like `listModels.ts`).

## Edge cases
- Anthropic response with no `tool_use` block (model refused / returned text) →
  `null`.
- OpenAI `content` that isn't valid JSON → `null`.
- Empty/whitespace input, amount 0 (honest failure) — handled downstream by the
  existing `isUsefulDeviceParse`/router gate, unchanged.
- Timeout at 15s → `null` (router falls back).
