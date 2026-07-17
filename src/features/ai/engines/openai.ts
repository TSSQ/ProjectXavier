/**
 * BYOK cloud parse engine — OpenAI. Mirrors
 * `src/features/ai/deviceParse.ts`'s `generateObject` path EXACTLY (see
 * `src/features/ai/engines/shared.ts`'s `runCloudParse`); the only thing
 * this file adds is building the OpenAI model from the user's OWN key
 * (`createOpenAI({ apiKey })`, never the default `openai` export, which
 * would read a developer-side `OPENAI_API_KEY` env var — there is no such
 * thing here, this is direct device→provider with the user's own key).
 *
 * Never throws: any failure (bad key, offline, timeout, rate limit, schema-
 * invalid output) resolves to `null` so the router
 * (src/domain/parseRouter.ts) falls through to Foundation Models / the
 * heuristic.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { AiParsedExpense } from '../../../lib/validation';
import { CloudParseContext, runCloudParse } from './shared';

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
  const provider = createOpenAI({ apiKey });
  return runCloudParse(provider(modelId), text, ctx, 'openai');
}
