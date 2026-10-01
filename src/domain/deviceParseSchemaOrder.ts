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
 * THE ZOD-TO-JSON-SCHEMA CALL-CHAIN (the one real explanation other doc
 * comments in this codebase point back at — `evals/fm/pipeline.mjs` and
 * `evals/engines/run_node.mjs` both reference this paragraph rather than
 * repeating it): `zodSchema()` (re-exported by `ai` from
 * `@ai-sdk/provider-utils`) is the SAME function `generateObject`'s own
 * `getOutputStrategy` calls on a zod schema internally (`asSchema` ->
 * `zodSchema()` when the schema carries zod's `"~standard"` marker). Calling
 * it here on `deviceParseSchema` therefore produces the byte-identical JSON
 * Schema the app's real call would derive; only `"x-order"` is added on top,
 * never any other key. `src/domain/orderedJsonSchema.ts`'s generalised
 * `orderedJsonSchema` (review B1 — the other four on-device callers) relies
 * on this exact same fact.
 *
 * Nested object properties do NOT inherit `"x-order"` — the patch
 * (`orderedPropertyNames`) only reads it off the object schema currently
 * being parsed, so a nested object would need its own `"x-order"` key at its
 * own level too. `deviceParseSchema` (like every other on-device contract in
 * this codebase today) is flat — no object-typed properties — so this
 * doesn't come up yet, but it would for any future nested contract.
 */
import { zodSchema } from 'ai';
import { deviceParseSchema } from './deviceParsePrompt';

/**
 * The chosen interim field order — step 1a.5's 2×2×2 factorial over 3
 * precedence rules applied to the base (zod declaration) order (category vs
 * type, amount vs type, payee vs category), replayed across all 39 dataset
 * cases × 8 candidate orders × 1 repeat (plus a ~5-cell ×2 determinism spot-
 * check — every repeated cell came back byte-identical and 0/N or N/N, never
 * fractional) via `evals/fm/replay-orders.mjs`. See evals/README.md's
 * "Field-order experiment" section for the full table.
 *
 * This order ("category, payee" before "type, amount") scored parse 27/32,
 * refusal 7/7 — the best of the 8 candidates, strictly better than both the
 * base/zod-declaration order (25/32) and the prior random-order baseline
 * (25/32, N=5) this experiment set out to beat, with no refusal regression.
 * It tied on raw score with exactly one other candidate
 * ("payee, category, type, amount, …"); the two were behaviourally
 * IDENTICAL — same parse/refusal counts, same per-axis breakdown, the exact
 * same 5 failing cases with the exact same wrong fields — so the tie was
 * broken by preferring the candidate with fewer rule-flips from the base
 * order (2 vs 3), not by any measured difference.
 *
 * This is explicitly an INTERIM choice on a 39-case dataset (32 of them
 * scored for parse accuracy), not a final one — revisit once the dataset
 * grows.
 */
export const DEVICE_PARSE_FIELD_ORDER = [
  'category',
  'payee',
  'type',
  'amount',
  'currency',
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
