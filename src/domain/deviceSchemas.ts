/**
 * The ONE place every on-device (`@react-native-ai/apple`) `generateObject`
 * call in `src/features/ai/deviceParse.ts` gets its `schema:` value from.
 *
 * Review finding (post-B1 QA): a caller in `deviceParse.ts` can be reverted
 * to a bare zod schema (losing the pinned `"x-order"` — step 1a.5/B1) and
 * nothing fails at build or test time, because a zod schema and an
 * `orderedJsonSchema(...)` result are both structurally valid values for
 * `generateObject`'s `schema:` option. Moving every call's schema object
 * here as a named export, and having `deviceParse.ts` import ONLY these
 * (never the raw zod schemas, never calling `orderedJsonSchema`/`jsonSchema`
 * itself), turns that regression into something a cheap static guard can
 * catch: `tests/__steps__/device-schemas-guard.steps.ts` reads
 * `deviceParse.ts` as text and asserts every `schema:` argument is one of
 * these five exports.
 *
 * Each export is built exactly the way its call site used to build it
 * inline:
 *  - `DEVICE_PARSE_SCHEMA` pins the measured `DEVICE_PARSE_FIELD_ORDER`
 *    (src/domain/deviceParseSchemaOrder.ts) — the expense parse's own,
 *    non-declaration order.
 *  - The other four pin their schema's own declaration order, which is
 *    `orderedJsonSchema`'s default — so no explicit order argument is
 *    passed here either.
 */
import { Schema } from 'ai';
import { z } from 'zod';
import { orderedJsonSchema } from './orderedJsonSchema';
import { deviceParseSchema } from './deviceParsePrompt';
import { DEVICE_PARSE_FIELD_ORDER } from './deviceParseSchemaOrder';
import { accountParseSchema } from './accountParseSchema';
import { accountUpdateParseSchema } from './accountUpdateSchema';
import { queryToolSelectionSchema } from './queryToolSelection';
import { transactionOpSelectionSchema } from './transactionOpSelection';

/** Expense parse (`deviceParseUnsafe`) — pinned to the measured order. */
export const DEVICE_PARSE_SCHEMA: Schema<z.infer<typeof deviceParseSchema>> = orderedJsonSchema(
  deviceParseSchema,
  DEVICE_PARSE_FIELD_ORDER
);

/** Account create (`deviceParseAccount`) — pinned to declaration order. */
export const ACCOUNT_CREATE_SCHEMA: Schema<z.infer<typeof accountParseSchema>> =
  orderedJsonSchema(accountParseSchema);

/** Account update (`deviceParseAccountUpdate`) — pinned to declaration order. */
export const ACCOUNT_UPDATE_SCHEMA: Schema<z.infer<typeof accountUpdateParseSchema>> =
  orderedJsonSchema(accountUpdateParseSchema);

/** Query tool selection (`deviceParseQuerySelection`) — pinned to declaration order. */
export const QUERY_TOOL_SELECTION_SCHEMA: Schema<z.infer<typeof queryToolSelectionSchema>> =
  orderedJsonSchema(queryToolSelectionSchema);

/** Transaction-op selection (`deviceParseTransactionOp`) — pinned to declaration order. */
export const TRANSACTION_OP_SELECTION_SCHEMA: Schema<z.infer<typeof transactionOpSelectionSchema>> =
  orderedJsonSchema(transactionOpSelectionSchema);
