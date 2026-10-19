/**
 * JSON Schema for the BYOK cloud engines' structured-output request bodies
 * (docs/design/byok-raw-fetch-spec.md) — Anthropic's tool `input_schema` and
 * OpenAI's `response_format.json_schema.schema`. Neither provider accepts a
 * zod schema directly over raw HTTP; they need plain JSON Schema.
 *
 * Since the step-2/3 port (Package A, PR 2) the cloud expense contract runs
 * the SAME per-text schema the on-device tier does: `fmParseSchemaFor(plan)`
 * (src/domain/fmParse.ts) — `isTransaction` first, a closed `category`
 * choice, and an `amount` field that is absent (code read the one amount),
 * a closed enum of the candidates in the text, or a free number, depending
 * on `planFmAmount(text)`. So the schema is built per text, not once.
 *
 * zod here is 3.25 (no native `z.toJSONSchema` on this API surface) and
 * `zod-to-json-schema` is NOT an installed dependency. Rather than hand-author
 * (and risk drifting from) a parallel schema, this reuses the zod3-to-JSON-
 * Schema converter the Vercel AI SDK already ships as a public export
 * (`zodSchema` from the `ai` package, which stays a runtime dependency for
 * `deviceParse.ts`'s native Foundation Models path — no new dependency is
 * introduced). It is the very same call `src/domain/deviceParseSchemaOrder.ts`
 * builds the on-device schema from (see that module's header for the
 * call-chain), minus the `"x-order"` key the native binding needs — the cloud
 * providers get plain JSON Schema with nothing non-standard in it.
 */
import { zodSchema } from 'ai';
import { fmParseSchemaFor } from './fmParse';
import { FmAmountPlan } from './fmAmountPlan';

/** The JSON Schema handed to Anthropic (`tools[].input_schema`) and OpenAI
 *  (`response_format.json_schema.schema`) for `plan` — structurally identical
 *  to `fmParseSchemaFor(plan)`: same property keys, same enum values, same
 *  required/optional split, and the same `.describe()` strings as
 *  `description`s. The converter is synchronous for a zod v3 schema. */
export function cloudExpenseJsonSchemaFor(plan: FmAmountPlan): Record<string, unknown> {
  return zodSchema(fmParseSchemaFor(plan)).jsonSchema as Record<string, unknown>;
}
