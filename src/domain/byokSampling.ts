/**
 * Pure, framework-free sampling-parameter gate for the BYOK cloud engines
 * (src/features/ai/engines/{openai,anthropic}.ts, src/features/ai/queryLoop.ts).
 *
 * Determinism: every BYOK request wants `temperature: 0` so byte-identical
 * text parses the same way run to run (the on-device tier is already pinned
 * — see deviceParse.ts). But not every model ACCEPTS the parameter, and a
 * rejected parameter is a 400 — i.e. the parse silently falls through to the
 * next engine, which is strictly worse than a nondeterministic parse:
 *
 *   - OpenAI reasoning models (the o-series and the GPT-5+/GPT-6+ families,
 *     which reason by default) reject `temperature` unless reasoning is
 *     turned off; the classic GPT models (gpt-3.5/gpt-4/gpt-4o/gpt-4.1,
 *     the `chatgpt-*` and `*-chat*` ids) accept it. Source: OpenAI's model
 *     guidance ("when reasoning effort is not `none`, remove `temperature`").
 *   - Anthropic removed sampling parameters from Claude 4.7 onward (a 400),
 *     and Haiku 5.5 / Sonnet 5.5 reject any NON-default value (a 400 too);
 *     Claude 4.6 and earlier (incl. the Haiku 4.5 default) accept it.
 *
 * So each gate is an ALLOWLIST: it returns true only for ids it can prove
 * accept the parameter, and false for anything unknown — an omitted
 * `temperature` always works, a sent one may not. The user can type or pick
 * ANY id in Settings (docs/design/byok-model-picker-spec.md), so this runs on
 * the raw id string with no list to maintain beyond the family rules above.
 */
import type { ByokProvider } from './parseRouter';

/** OpenAI ids that take `temperature` — the non-reasoning GPT families.
 *  Everything else (o1/o3/o4…, gpt-5*, gpt-6*, and anything unrecognised)
 *  is treated as a reasoning model and gets no sampling parameter. */
export function openAiSupportsTemperature(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith('gpt-3.5') || id.startsWith('gpt-4')) return true;
  if (id.startsWith('chatgpt-')) return true;
  // The non-reasoning "chat" snapshots of the GPT-5 line (e.g.
  // gpt-5-chat-latest) are the one GPT-5-family exception.
  if (id.startsWith('gpt-5') && id.includes('-chat')) return true;
  return false;
}

/**
 * The Claude model-family version encoded in an id, as [major, minor] — e.g.
 * `claude-haiku-4-5` and `claude-3-5-haiku-20241022` both carry a version;
 * `claude-sonnet-4-20250514` is [4, 0] (an 8-digit segment is a date, not a
 * minor); `claude-sonnet-5` is [5, 0]. `null` when the id carries no version
 * at all. Exported for the BDD suite only.
 */
export function anthropicModelVersion(modelId: string): [number, number] | null {
  const id = modelId.trim().toLowerCase();
  if (!id.startsWith('claude-')) return null;
  const numeric = id
    .slice('claude-'.length)
    .split('-')
    .map((seg) => (/^\d{1,2}$/.test(seg) ? Number(seg) : null));
  const first = numeric.findIndex((n) => n !== null);
  if (first === -1) return null;
  const major = numeric[first] as number;
  const next = numeric[first + 1];
  const minor = typeof next === 'number' ? next : 0;
  return [major, minor];
}

/** Anthropic ids that take `temperature` — Claude 4.6 and earlier. Claude
 *  4.7+ (incl. every 5.x id) returns a 400 for it, so those — and any id
 *  whose version can't be read — get no sampling parameter. */
export function anthropicSupportsTemperature(modelId: string): boolean {
  const version = anthropicModelVersion(modelId);
  if (!version) return false;
  const [major, minor] = version;
  return major < 4 || (major === 4 && minor <= 6);
}

/**
 * The sampling fields to spread into a provider request body:
 * `{ temperature: 0 }` when `modelId` accepts it, `{}` otherwise. One call
 * site shape for every BYOK body (parse engines and the query loop) so the
 * rule can't drift between them.
 */
export function byokSamplingParams(
  provider: ByokProvider,
  modelId: string
): { temperature: 0 } | Record<string, never> {
  const supported =
    provider === 'openai'
      ? openAiSupportsTemperature(modelId)
      : anthropicSupportsTemperature(modelId);
  return supported ? { temperature: 0 } : {};
}
