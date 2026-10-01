/**
 * Deterministic field order for the on-device parse schema (step 1a.5).
 *
 * `@react-native-ai/apple`'s native schema parser
 * (`AppleLLMSchemaParser.parseObjectSchema`, ios/AppleLLMImpl.swift) used to
 * build a `DynamicGenerationSchema`'s properties by iterating a Swift
 * `Dictionary` — whose iteration order is randomized PER CAST, not just per
 * process. Experiments proved the model's accuracy is a deterministic
 * function of (case, exact field order), so a random order on every call
 * made accuracy itself effectively random. `patches/
 * @react-native-ai+apple+*.patch` (applied via patch-package's `postinstall`
 * hook) fixes this: the native parser now honours an explicit `"x-order"`
 * array on the object JSON Schema when it's an exact permutation of the
 * schema's own property keys (falling back to sorted-key order otherwise,
 * so generation is still deterministic even without `"x-order"`, and an
 * invalid one never crashes generation).
 *
 * This module is the ONE place that derives the JSON Schema
 * `generateObject({schema: deviceParseSchema, ...})` sends, plus that
 * `"x-order"` key — `src/features/ai/deviceParse.ts` (the app),
 * `evals/engines/run_node.mjs` (`runFM`), and `evals/fm/replay-orders.mjs`
 * all call it, so the app and every eval tool build the exact same schema
 * object (never a hand-copied one that could drift).
 *
 * `zodSchema()` (re-exported by `ai` from `@ai-sdk/provider-utils`) is the
 * SAME function `generateObject`'s own `getOutputStrategy` calls on a zod
 * schema internally (`asSchema` -> `zodSchema()` when the schema carries
 * zod's `"~standard"` marker) — see `evals/engines/run_node.mjs`'s own
 * `zodSchema` import comment for the full call-chain proof. Calling it here
 * on `deviceParseSchema` therefore produces the byte-identical JSON Schema
 * the app's real call would derive; only `"x-order"` is added on top, never
 * any other key.
 */
import { zodSchema } from 'ai';
import { deviceParseSchema } from './deviceParsePrompt';

/**
 * The chosen interim field order (step 1a.5's 2×2×2 factorial over the zod
 * declaration order — category vs type, amount vs type, payee vs category —
 * run across the full 32-case parse population; see evals/README.md's
 * "Field-order experiment" section for the full table). Picked only because
 * it scored at least as well as the prior random-order baseline (parse
 * 25/32, refusal 7/7); this is explicitly an INTERIM choice on a 32-case
 * dataset, not a final one — revisit once the dataset grows.
 */
export const DEVICE_PARSE_FIELD_ORDER = [
  'category',
  'amount',
  'type',
  'currency',
  'payee',
  'account',
  'note',
  'occurredOn',
  'confidence',
  'pending',
] as const;

let baseJsonSchemaCache: Record<string, unknown> | null = null;

/** `zodSchema(deviceParseSchema).jsonSchema` — lazily computed and cached,
 *  same as `evals/engines/run_node.mjs`'s `getDeviceParseJsonSchema` (kept as
 *  its own small cache here rather than sharing a module-level singleton
 *  across callers, since each caller — app process, eval process — only ever
 *  needs its own). */
function getDeviceParseBaseJsonSchema(): Record<string, unknown> {
  if (!baseJsonSchemaCache) {
    baseJsonSchemaCache = zodSchema(deviceParseSchema).jsonSchema as Record<string, unknown>;
  }
  return baseJsonSchemaCache;
}

/**
 * The exact JSON Schema `generateObject({schema: deviceParseSchema, ...})`
 * would derive, plus `"x-order": order` (defaults to
 * `DEVICE_PARSE_FIELD_ORDER`) — nothing else changes. Pass an explicit
 * `order` to override it (only ever done by the dev-only replay harness,
 * `evals/fm/replay-orders.mjs`, which pre-flight-checks that the override is
 * an exact permutation of this schema's own property keys before ever
 * spawning the probe).
 */
export function getDeviceParseOrderedJsonSchema(
  order: readonly string[] = DEVICE_PARSE_FIELD_ORDER
): Record<string, unknown> {
  return { ...getDeviceParseBaseJsonSchema(), 'x-order': order };
}
