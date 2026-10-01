/**
 * The ONE place every on-device (`@react-native-ai/apple`) `generateObject`
 * call in `src/features/ai/deviceParse.ts` gets its `schema:` value from —
 * `deviceParse.ts` imports only these five exports, never a bare zod schema,
 * so a call site can't silently lose its pinned `"x-order"` (step 1a.5/B1).
 * See `tests/__steps__/device-schemas-guard.steps.ts` for the guard that
 * enforces this.
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
