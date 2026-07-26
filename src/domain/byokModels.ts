/**
 * BYOK model-picker normalizers (docs/design/byok-model-picker-spec.md) —
 * pure, framework-free reduction of each provider's raw `/v1/models` payload
 * into a `ModelChoice[]` the Settings screen can render in a picker.
 *
 * The raw payload is a network response from a third-party API and MUST be
 * treated as untrusted (CLAUDE.md guardrail #6): every field access below is
 * guarded, and any shape that doesn't match expectations (non-array `data`,
 * missing fields, non-string ids, etc.) is simply dropped from the result —
 * never thrown. Garbage in yields `[]`, not a crash.
 */
import { ByokProvider } from './parseRouter';

export interface ModelChoice {
  id: string;
  label: string;
}

/** OpenAI id prefixes that indicate a chat-capable model worth offering. */
const OPENAI_CHAT_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt'];

/** Substrings that mark a non-chat modality/legacy model to exclude even if
 *  the id happens to start with an included prefix. */
const OPENAI_EXCLUDE_SUBSTRINGS = [
  'embedding',
  'whisper',
  'tts',
  'audio',
  'realtime',
  'dall-e',
  'moderation',
  'image',
  'transcribe',
  'search',
  'davinci',
  'babbage',
  'codex',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Pull the `data` array out of an untrusted `/v1/models` payload; anything
 *  else (missing, non-array, not even an object) resolves to `[]`. */
function extractDataArray(raw: unknown): unknown[] {
  if (!isRecord(raw)) return [];
  const data = raw.data;
  return Array.isArray(data) ? data : [];
}

/**
 * Anthropic — keep a model unless it explicitly reports
 * `capabilities.structured_outputs.supported === false`; lenient to older
 * api-versions that omit `capabilities` entirely. Label prefers
 * `display_name`, falling back to `id`. Preserves API order (newest first).
 */
export function normalizeAnthropicModels(raw: unknown): ModelChoice[] {
  const items = extractDataArray(raw);
  const result: ModelChoice[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = item.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seenIds.has(id)) continue;

    const capabilities = isRecord(item.capabilities) ? item.capabilities : undefined;
    const structuredOutputs = capabilities && isRecord(capabilities.structured_outputs)
      ? capabilities.structured_outputs
      : undefined;
    if (structuredOutputs?.supported === false) continue;

    const displayName = item.display_name;
    const label = typeof displayName === 'string' && displayName.length > 0 ? displayName : id;
    seenIds.add(id);
    result.push({ id, label });
  }
  return result;
}

/**
 * OpenAI — heuristic chat-model filter (no capability flags in the API):
 * include ids with a chat-model prefix, exclude ids that mention a non-chat
 * modality/legacy marker, sort by `created` descending (newest first).
 */
export function normalizeOpenAiModels(raw: unknown): ModelChoice[] {
  const items = extractDataArray(raw);
  const candidates: Array<{ id: string; created: number }> = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = item.id;
    if (typeof id !== 'string' || id.length === 0) continue;

    const lower = id.toLowerCase();
    const isChatModel = OPENAI_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
    if (!isChatModel) continue;
    const isExcluded = OPENAI_EXCLUDE_SUBSTRINGS.some((marker) => lower.includes(marker));
    if (isExcluded) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const created = typeof item.created === 'number' && Number.isFinite(item.created) ? item.created : 0;
    candidates.push({ id, created });
  }
  // Stable sort (Array.prototype.sort is stable per spec) preserves the
  // first-occurrence's position among same-`created` duplicates.
  return candidates
    .sort((a, b) => b.created - a.created)
    .map(({ id }) => ({ id, label: id }));
}

/** Dispatch to the provider-specific normalizer. */
export function normalizeModels(provider: ByokProvider, raw: unknown): ModelChoice[] {
  return provider === 'openai' ? normalizeOpenAiModels(raw) : normalizeAnthropicModels(raw);
}

/** Whether `id` is present among the fetched `models`. */
export function isKnownModel(models: ModelChoice[], id: string): boolean {
  return models.some((m) => m.id === id);
}

/**
 * Guards a stale `listByokModels` response from clobbering state
 * (app/settings/byok.tsx) — a slow fetch that resolves after a newer one has
 * already been issued must not apply its result. Every provider switch and
 * every key removal routes through another `loadModels` call (or an explicit
 * token bump), which always advances the token first — so a stale-provider
 * or post-removal result is always a stale token too; a single counter fully
 * closes the race without needing to also compare providers. The caller (a
 * `loadModels` generation counter) captures `requestToken` when the fetch
 * starts; on resolve it's only safe to apply the result when the request is
 * still the most recent one issued.
 */
export function shouldApplyModelsResult(args: {
  requestToken: number;
  latestToken: number;
}): boolean {
  return args.requestToken === args.latestToken;
}
