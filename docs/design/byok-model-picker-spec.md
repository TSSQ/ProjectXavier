# BYOK model picker — dynamic dropdown from the provider's `/v1/models`

## Objective
Replace the free-text **Model** field in `app/settings/byok.tsx` with a picker
populated by fetching the provider's live model list with the user's key. This
kills the whole class of typo/format errors (a mistyped id like `sonnet-4.6`
instead of `claude-sonnet-4-6` currently returns a 404 that the Test-key screen
mislabels as "couldn't reach the provider"). Chosen approach: **fetch from the
provider API** (user decision, 2026-07-17), with a manual-entry fallback so the
screen still works before a key is saved / offline / on fetch failure.

## Scope
- New pure domain module `src/domain/byokModels.ts` — normalize + filter each
  provider's raw model list into a `ModelChoice[]`. Node-testable, no I/O.
- New feature module `src/features/ai/listModels.ts` — the network shell that
  GETs `/v1/models`, mirrors the security hygiene of
  `src/features/ai/testKey.ts` (AbortController timeout, never throws, never
  logs key/headers/body), classifies failures, and runs the raw list through
  the domain normalizer.
- `app/settings/byok.tsx` — swap the Model `TextInput` for a tap-to-open picker
  backed by the fetched list, with a persistent **Custom…** option that reveals
  the old text field, plus fallback/loading/error states.
- Fold-ins (both directly caused the confusion this feature fixes):
  - `src/features/ai/testKey.ts` — split the catch-all so a 404 → `not_found`
    ("model not found — check the model id"), distinct from `invalid`
    (401/403) and `network` (offline/timeout/other).
  - `src/features/settings/repository.ts` — update `DEFAULT_BYOK_MODEL.anthropic`
    from the stale `claude-3-5-haiku-latest` to `claude-haiku-4-5`
    (`gpt-4o-mini` stays for OpenAI).

### Out of scope
- No change to the actual parse engines (`engines/openai.ts`, `anthropic.ts`,
  `shared.ts`) or `parseRouter.ts` — this is Settings-only.
- No caching/persistence of the fetched list (fetch on demand; cheap GET).
- No pagination beyond the first page (both providers return the useful models
  in the first 100; request `limit=1000` for Anthropic, single page for OpenAI).

## Endpoint contracts (verified against live docs 2026-07-17)

### Anthropic — rich, preferred
```
GET https://api.anthropic.com/v1/models?limit=1000
headers: anthropic-version: 2023-06-01
         x-api-key: <key>
```
Response: `{ data: [{ id, display_name, created_at, capabilities: {
structured_outputs: { supported: boolean }, ... }, type: "model" }],
has_more, first_id, last_id }`. Newest first.
- Filter: keep a model when
  `capabilities?.structured_outputs?.supported !== false` (keep if the field is
  absent — be lenient to API-version drift; drop only an explicit `false`).
- Label: `display_name` (fallback to `id`). Preserve API order (newest first).

### OpenAI — sparse, needs heuristic filter
```
GET https://api.openai.com/v1/models
headers: Authorization: Bearer <key>
```
Response: `{ object: "list", data: [{ id, object: "model", created,
owned_by }] }`. No capability flags, no display name.
- Filter: INCLUDE ids starting with `gpt-`, `o1`, `o3`, `o4`, or `chatgpt`;
  EXCLUDE any id containing a non-chat modality marker:
  `embedding`, `whisper`, `tts`, `audio`, `realtime`, `dall-e`, `moderation`,
  `image`, `transcribe`, `search`, `davinci`, `babbage`, `codex`.
- Label: the `id` itself (OpenAI gives no friendly name).
- Sort by `created` descending (newest first).

## `src/domain/byokModels.ts` (pure)
```ts
export interface ModelChoice { id: string; label: string }

// Lenient to missing `capabilities` (older api-version); drop only explicit
// structured_outputs.supported === false.
export function normalizeAnthropicModels(raw: unknown): ModelChoice[]

// Heuristic chat-model filter per the rules above; sort by created desc.
export function normalizeOpenAiModels(raw: unknown): ModelChoice[]

export function normalizeModels(
  provider: ByokProvider, raw: unknown
): ModelChoice[]   // dispatches to the two above

export function isKnownModel(models: ModelChoice[], id: string): boolean
```
Guard every field access (the payload is an untrusted trust boundary —
guardrail #6): tolerate missing/extra fields, non-array `data`, non-string
`id`, etc., and return `[]` rather than throwing on garbage.

## `src/features/ai/listModels.ts` (I/O shell)
```ts
export type ListModelsResult =
  | { ok: true; models: ModelChoice[] }
  | { ok: false; reason: 'invalid' | 'network' };

export async function listByokModels(
  provider: ByokProvider, apiKey: string
): Promise<ListModelsResult>
```
- Raw `fetch` (not the AI SDK — this is a plain GET, not `generateObject`).
- `AbortController` with `CLOUD_REQUEST_TIMEOUT_MS` from `engines/shared.ts`.
- Classify like `testKey.ts`: `res.status === 401 || 403` → `invalid`;
  any thrown error / non-OK status / parse failure → `network`. Never throws.
- On 2xx: parse JSON, run through `normalizeModels(provider, json)`.
- NEVER log the key, the Authorization/x-api-key header, or the response body —
  only a generic key-free label to `console.warn`, exactly like `shared.ts`.

## `app/settings/byok.tsx` UI
State: `models: ModelChoice[] | null`, `modelsLoading`, `modelsError:
'invalid'|'network'|null`, `useCustom: boolean`.
- **Fetch triggers**: on focus when a key is saved; after a successful Save key;
  on provider change when a key is saved; and a manual "Reload models" control.
- **Model row**: a tappable row (not a raw TextInput) showing the current
  model's label. Tapping opens a picker (a simple modal list is fine — match
  existing UI primitives; there's a `SegmentedControl` but the list can be
  long, so use a modal/scroll list) containing every fetched `ModelChoice`
  plus a trailing **Custom…** row.
  - Selecting a model → `setByokModel(provider, id)`, `useCustom = false`.
  - Selecting **Custom…** → `useCustom = true`, reveal the existing secure-less
    `TextInput` (unchanged behaviour: `onEndEditing` persists, empty → default).
- **Fallback / states**:
  - No key saved → show the Custom text field + hint "Save a key to load
    available models."
  - `modelsLoading` → a spinner/"Loading models…" row.
  - `modelsError === 'invalid'` → "That key was rejected — save a valid key to
    load models." + Custom field.
  - `modelsError === 'network'` → "Couldn't load models — offline or the
    provider is unreachable." + Retry + Custom field.
  - If the currently-saved `model` isn't in the fetched list, still show it
    selected (don't silently reset the user's choice); it just reads as a
    custom/unlisted id.
- Keep the existing key field, Save/Remove, and Test-key sections as-is (except
  Test-key copy gains the `not_found` case).

## Acceptance criteria
1. With a valid Anthropic key saved, opening the Model picker lists real Claude
   models by their display names (e.g. "Claude Haiku 4.5", "Claude Sonnet 4.6"),
   newest first, and only models whose `structured_outputs` isn't explicitly
   unsupported.
2. With a valid OpenAI key, the picker lists `gpt-*`/`o*` chat models newest
   first and excludes embeddings/whisper/tts/dall-e/etc.
3. Selecting a model persists it (survives leaving + re-entering the screen) and
   is the id used by Test-key and by real parses.
4. **Custom…** reveals a text field that still accepts an arbitrary id and
   persists it; a saved custom id that isn't in the list still shows selected.
5. No key / offline / rejected key → the screen degrades to manual entry with a
   clear reason; never a dead-end where no model can be chosen.
6. `listByokModels` never throws and never logs the key/headers/body; a bad key
   returns `{ ok:false, reason:'invalid' }`, offline returns
   `{ ok:false, reason:'network' }`.
7. Test-key now distinguishes `not_found` (404, bad model id) from `invalid`
   and `network`, with matching copy.
8. Anthropic default model is `claude-haiku-4-5`.
9. `npm run typecheck && npm run lint && npm test` all green; new pure domain
   tests cover both normalizers (filtering, ordering, label fallback, empty and
   malformed input).

## Constraints
- Parameterised/guarded parsing of untrusted API payloads (guardrail #6); no
  key/PII logging (guardrail #5). Domain logic stays framework-free so the
  plain-Node BDD suite exercises the normalizers.
