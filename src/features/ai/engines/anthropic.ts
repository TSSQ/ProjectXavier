/**
 * BYOK cloud parse engine — Anthropic. Mirrors
 * `src/features/ai/deviceParse.ts`'s `generateObject` path EXACTLY (see
 * `src/features/ai/engines/shared.ts`'s `runCloudParse`); the only thing
 * this file adds is building the Anthropic model from the user's OWN key
 * (`createAnthropic({ apiKey })`, never the default `anthropic` export,
 * which would read a developer-side `ANTHROPIC_API_KEY` env var — there is
 * no such thing here, this is direct device→provider with the user's own
 * key).
 *
 * Never throws: any failure (bad key, offline, timeout, rate limit, schema-
 * invalid output) resolves to `null` so the router
 * (src/domain/parseRouter.ts) falls through to Foundation Models / the
 * heuristic.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { AiParsedExpense } from '../../../lib/validation';
import { CloudParseContext, runCloudParse } from './shared';

/**
 * Parse `text` via the user's own Anthropic key and model.
 *
 * @param apiKey  The user's own Anthropic API key (from Keychain — see
 *   src/features/ai/byokKey.ts — never persisted anywhere else).
 * @param modelId The model to call (e.g. "claude-3-5-haiku-latest",
 *   user-editable in Settings — see DEFAULT_BYOK_MODEL in
 *   src/features/settings/repository.ts).
 */
export async function anthropicParse(
  text: string,
  ctx: CloudParseContext,
  apiKey: string,
  modelId: string
): Promise<AiParsedExpense | null> {
  const provider = createAnthropic({ apiKey });
  return runCloudParse(provider(modelId), text, ctx, 'anthropic');
}
