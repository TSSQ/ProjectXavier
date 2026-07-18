/**
 * JSON Schema equivalent of `deviceParsePrompt.ts`'s `deviceParseSchema`, for
 * the BYOK cloud engines' structured-output request bodies
 * (docs/design/byok-raw-fetch-spec.md) — Anthropic's tool `input_schema` and
 * OpenAI's `response_format.json_schema.schema`. Neither provider accepts a
 * zod schema directly over raw HTTP; they need plain JSON Schema.
 *
 * zod here is 3.25 (no native `z.toJSONSchema` on this API surface) and
 * `zod-to-json-schema` is NOT an installed dependency. Rather than hand-author
 * (and risk drifting from) a parallel schema, this reuses the zod3-to-JSON-
 * Schema converter the Vercel AI SDK already ships as a public export
 * (`zodSchema` from the `ai` package, which stays a runtime dependency for
 * `deviceParse.ts`'s native Foundation Models path — no new dependency is
 * introduced). `tests/__steps__/device-parse-prompt.steps.ts` already relies
 * on the very same `zodSchema(deviceParseSchema).jsonSchema` call to prove the
 * schema stays expressible by the on-device FM binding; this module just
 * gives the BYOK cloud engines one shared, cached copy of that same
 * conversion so `deviceParseSchema` remains the single source of truth (see
 * `tests/__features__/cloud-parse-transport.feature` for the parity check
 * against this constant specifically).
 */
import { zodSchema } from 'ai';
import { deviceParseSchema } from './deviceParsePrompt';

/** The JSON Schema handed to Anthropic (`tools[].input_schema`) and OpenAI
 *  (`response_format.json_schema.schema`) — structurally identical to
 *  `deviceParseSchema`: same property keys, same enum values, same
 *  required/optional split, and the same `.describe()` strings as
 *  `description`s. Computed once at module load (the underlying converter is
 *  synchronous for a zod v3 schema — no promise ever resolves here). */
export const DEVICE_PARSE_JSON_SCHEMA = zodSchema(deviceParseSchema).jsonSchema as Record<
  string,
  unknown
>;
