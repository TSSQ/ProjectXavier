/**
 * Generalised "pinned field order" schema helper for every on-device
 * (`@react-native-ai/apple`) `generateObject` call, not just the expense
 * parse contract.
 *
 * Step 1a.5's patch (`patches/@react-native-ai+apple+*.patch`) made the
 * native schema parser (`AppleLLMSchemaParser.parseObjectSchema`,
 * `node_modules/@react-native-ai/apple/ios/AppleLLMImpl.swift`) build a
 * `DynamicGenerationSchema`'s properties in the order given by an explicit
 * `"x-order"` array on the JSON Schema, when it is an exact permutation of
 * the schema's own property keys — falling back to SORTED-key order
 * otherwise (never Swift `Dictionary`'s per-cast-randomized order). That
 * sorted-key fallback is itself a real, deterministic behaviour change from
 * "whatever order the model was originally probed/tuned against" for every
 * caller that sends no `"x-order"` at all — review finding B1: the four
 * on-device callers OTHER than the expense parse (account create, account
 * update, query tool selection, transaction-op selection, all in
 * `src/features/ai/deviceParse.ts`) were silently moved onto alphabetical
 * order by the patch, the reverse of the order their prompts/few-shot
 * reasoning were developed against.
 *
 * This module is the ONE place that builds an `"x-order"`-pinned `Schema`
 * (the AI SDK's own `Schema<T>`, ready to hand straight to `generateObject`'s
 * `schema:` option) from a zod object schema. `src/domain/
 * deviceParseSchemaOrder.ts` is the expense parse's OWN, more specific
 * version of this same idea (it pins a measured, non-declaration order —
 * see its own doc comment for the full zod-to-JSON-Schema call-chain
 * explanation that applies here too) and is unaffected by this module; every
 * other on-device caller should use this one instead of sending a bare zod
 * schema straight to `generateObject`.
 *
 * Nested object properties do NOT inherit `"x-order"` — the patch only reads
 * it off the OBJECT schema currently being parsed, so a nested object would
 * need its own `"x-order"` key at its own level to get a pinned order too.
 * Every schema `orderedJsonSchema` is used on today (expense parse, account
 * create/update, query tool selection, transaction-op selection) is flat —
 * no object-typed properties — so this doesn't come up yet, but it would for
 * any future nested contract.
 */
import { z } from 'zod';
import { zodSchema, jsonSchema, Schema } from 'ai';

/** `Object.keys(schema.shape)` — a zod object schema's own declaration
 *  order, i.e. the order its fields are written in the `z.object({...})`
 *  call. The default `order` `orderedJsonSchema` pins when a caller doesn't
 *  provide its own measured order (as the expense parse's
 *  `DEVICE_PARSE_FIELD_ORDER` does) — "the order this contract's prompt/
 *  schema was authored in, and its probes were run against", per review
 *  finding B1. */
export function declarationOrder<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>
): string[] {
  return Object.keys(schema.shape);
}

/**
 * Build the `Schema<T>` `generateObject({schema: ..., ...})` should receive
 * for `schema` on an on-device (Foundation Models) call: the exact JSON
 * Schema `zodSchema(schema)` would derive, plus a pinned `"x-order"` array
 * (defaults to `declarationOrder(schema)`), and the SAME `validate` function
 * `zodSchema(schema)` itself exposes — `generateObject`'s own internal
 * `asSchema`/`zodSchema` call for a bare zod schema would run this exact
 * validator, so reusing it here (rather than hand-rolling a second
 * `schema.safeParse` wrapper) keeps guardrail #6 (AI output is untrusted —
 * validated, not trusted) intact with zero duplicated validation logic.
 *
 * `order` must be an exact permutation of `schema`'s own keys — this is
 * enforced by each caller's own BDD test, not re-checked at runtime here
 * (the native patch already falls back to sorted-key order on an invalid
 * `"x-order"` rather than crashing, so a bad order from a caller that skips
 * its test degrades instead of throwing — but it should never happen).
 */
export function orderedJsonSchema<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  order: readonly string[] = declarationOrder(schema)
): Schema<z.infer<z.ZodObject<Shape>>> {
  const base = zodSchema(schema);
  // Built as a separately-typed `Record<string, unknown>` (not a fresh
  // object literal passed straight into `jsonSchema(...)`) so TS's excess-
  // property check — `"x-order"` isn't a recognised `JSONSchema7` key —
  // doesn't fire; `jsonSchema()`'s own type accepts a `JSONSchema7`-shaped
  // *value*, and a non-literal variable isn't excess-property-checked.
  // `getDeviceParseOrderedJsonSchema` (deviceParseSchemaOrder.ts) relies on
  // the exact same variable-not-literal trick.
  const merged: Record<string, unknown> = {
    ...(base.jsonSchema as Record<string, unknown>),
    'x-order': order,
  };
  return jsonSchema(merged, { validate: base.validate });
}
