/**
 * Parse-engine router — pure, framework-free (Node-testable). Decides the
 * ORDER `runParse` (app/(tabs)/index.tsx) tries its parse engines in, given
 * the current context: whether the device can run Apple Foundation Models,
 * the user's BYOK (bring-your-own-key) preference, and whether the device is
 * currently online.
 *
 * "enable BYOK = use my provider": when BYOK is on and reachable, the chosen
 * cloud provider runs FIRST, falling back to on-device Foundation Models and
 * then the deterministic heuristic on any error, timeout, or when offline —
 * a cloud engine failing never blocks the fallback chain (see
 * src/features/ai/engines/openai.ts / anthropic.ts, which return null rather
 * than throw). This module only decides ORDER; it never calls a provider or
 * touches the Keychain/settings itself — those live in src/features/ai.
 */

/** The parse engines the app can run, in the order `routeEngines` proposes.
 *  'foundation' = Apple Foundation Models (src/features/ai/deviceParse.ts);
 *  'heuristic' = the deterministic offline floor (src/domain/localParse.ts). */
export type EngineId = 'openai' | 'anthropic' | 'foundation' | 'heuristic';

/** A BYOK cloud provider id — a subset of EngineId. */
export type ByokProvider = 'openai' | 'anthropic';

export interface ByokRouteConfig {
  /** Whether BYOK is toggled on AND a key is actually saved for `provider`
   *  (see `resolveByokEnabled`) — the router itself never reads the
   *  Keychain, so callers must resolve this before building the context. */
  enabled: boolean;
  /** The chosen provider, or null if none has been picked yet. */
  provider: ByokProvider | null;
}

export interface RouteContext {
  /** Whether Apple Foundation Models is ready to run right now (see
   *  isDeviceAiAvailable in src/features/ai/deviceParse.ts). */
  deviceAiCapable: boolean;
  byok: ByokRouteConfig;
  /** Whether the device currently has network reachability. */
  online: boolean;
}

/**
 * Resolve the effective BYOK "enabled" flag: a config saying "enabled" with
 * no key actually saved for the provider must be treated as off — there's
 * nothing for the provider engine to call (see the spec's "BYOK on but no
 * key saved yet → treat as off" edge case). Kept separate from
 * `routeEngines` so the "config says on, but no key" resolution has its own
 * pure, directly-testable unit.
 */
export function resolveByokEnabled(configEnabled: boolean, hasKey: boolean): boolean {
  return configEnabled && hasKey;
}

/**
 * Decide the ordered list of parse engines to try for one parse:
 *   - BYOK off                → [foundation?, heuristic]
 *   - BYOK on + online        → [provider, foundation?, heuristic]
 *   - BYOK on + offline       → [foundation?, heuristic] (provider dropped —
 *     nothing to call, so it falls straight through rather than wasting a
 *     network attempt that would only time out)
 * `foundation` only appears when `deviceAiCapable`; `heuristic` always
 * appears last as the guaranteed-to-answer floor.
 */
export function routeEngines(ctx: RouteContext): EngineId[] {
  const engines: EngineId[] = [];
  if (ctx.byok.enabled && ctx.byok.provider && ctx.online) {
    engines.push(ctx.byok.provider);
  }
  if (ctx.deviceAiCapable) {
    engines.push('foundation');
  }
  engines.push('heuristic');
  return engines;
}
