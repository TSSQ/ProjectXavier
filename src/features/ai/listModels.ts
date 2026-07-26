/**
 * BYOK model-list fetch (docs/design/byok-model-picker-spec.md) — the network
 * shell backing the Settings model picker (app/settings/byok.tsx). GETs the
 * provider's `/v1/models` with the user's key using a raw `fetch` (this is a
 * plain list call, not a `generateObject` round-trip, so it doesn't go
 * through the AI SDK), then runs the response through
 * `src/domain/byokModels.ts`'s pure normalizer.
 *
 * Mirrors the security hygiene of `testKey.ts` / `engines/shared.ts`: an
 * AbortController timeout (CLOUD_REQUEST_TIMEOUT_MS), never throws, and NEVER
 * logs the key, the Authorization/x-api-key header, or the response body —
 * only a generic, key-free label reaches `console.warn`.
 */
import { ByokProvider } from '../../domain/parseRouter';
import { ModelChoice, normalizeModels } from '../../domain/byokModels';
import { CLOUD_REQUEST_TIMEOUT_MS } from './engines/shared';

export type ListModelsResult =
  | { ok: true; models: ModelChoice[] }
  | { ok: false; reason: 'invalid' | 'network' };

function requestFor(provider: ByokProvider, apiKey: string): { url: string; headers: Record<string, string> } {
  return provider === 'openai'
    ? {
        url: 'https://api.openai.com/v1/models',
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    : {
        url: 'https://api.anthropic.com/v1/models?limit=1000',
        headers: { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
      };
}

/**
 * Fetch and normalize `provider`'s model list using `apiKey`. Never throws.
 */
export async function listByokModels(
  provider: ByokProvider,
  apiKey: string
): Promise<ListModelsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const { url, headers } = requestFor(provider, apiKey);
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'invalid' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'network' };
    }
    const json: unknown = await res.json();
    return { ok: true, models: normalizeModels(provider, json) };
  } catch (e) {
    // Deliberately key/content-free — see engines/shared.ts's runCloudParse:
    // only a generic, key-free label ever reaches the console.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn('listByokModels failed:', label);
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
