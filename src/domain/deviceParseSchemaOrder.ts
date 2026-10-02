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
import { fmParseSchemaFor } from './fmParse';
import { FmAmountPlan } from './fmAmountPlan';

/**
 * The chosen field order (re-picked in step 3; evals/README.md, "Step 3 field
 * order re-pick" has the table and the history).
 *
 * `isTransaction` is first by design: it is the leading log-or-refuse decision,
 * so it has to be made before category, payee and type can drag the model
 * toward "an expense". Step 1a.5 had chosen "category, payee, type, amount, ..."
 * from a 2x2x2 factorial over 39 cases; step 3 re-ran five candidate orders,
 * all starting with `isTransaction`, across the 207 dev cases (one repeat each,
 * `evals/fm/replay-orders.mjs`; generation is deterministic per case and
 * order). Putting `amount` right after the verdict scored 196/207 against 194
 * for the previous relative order and fixed two cases (both a text with a
 * quantity and a price, where the model picks the amount from a closed list)
 * without breaking any. `amount` only exists in the schema for a text with
 * several or no amount candidates (src/domain/fmParse.ts), so for most texts
 * the order is `isTransaction, category, payee, type, currency, ...`.
 */
export const DEVICE_PARSE_FIELD_ORDER = [
  'isTransaction',
  'amount',
  'category',
  'payee',
  'type',
  'currency',
  'account',
  'note',
  'occurredOn',
  'confidence',
  'pending',
] as const;

/** `order` without `amount` when the plan leaves the amount to code (a
 *  `single` plan's schema has no such field, and "x-order" must be an exact
 *  permutation of the schema's own keys). */
export function fieldOrderFor(
  plan: FmAmountPlan,
  order: readonly string[] = DEVICE_PARSE_FIELD_ORDER
): readonly string[] {
  return plan.mode === 'single' ? order.filter((k) => k !== 'amount') : order;
}

/**
 * The exact JSON Schema `generateObject({schema: ..., ...})` would derive for
 * `plan`'s FM schema (`fmParseSchemaFor`), plus `"x-order"` (`fieldOrderFor`:
 * `DEVICE_PARSE_FIELD_ORDER` unless `order` overrides it) - nothing else
 * changes. An explicit `order` is only ever passed by the dev-only replay
 * harness (`evals/fm/replay-orders.mjs`), which pre-flight-checks that it is an
 * exact permutation of the schema's own property keys before spawning the probe.
 */
export function getDeviceParseOrderedJsonSchema(
  plan: FmAmountPlan = { mode: 'model' },
  order: readonly string[] = DEVICE_PARSE_FIELD_ORDER
): Record<string, unknown> {
  return {
    ...(zodSchema(fmParseSchemaFor(plan)).jsonSchema as Record<string, unknown>),
    'x-order': fieldOrderFor(plan, order),
  };
}
