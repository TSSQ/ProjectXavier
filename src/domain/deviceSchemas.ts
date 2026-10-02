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
import { fmParseSchemaFor } from './fmParse';
import { FmAmountPlan } from './fmAmountPlan';
import { fieldOrderFor } from './deviceParseSchemaOrder';
import { accountParseSchema } from './accountParseSchema';
import { accountUpdateParseSchema } from './accountUpdateSchema';
import { queryToolSelectionSchema } from './queryToolSelection';
import { transactionOpSelectionSchema } from './transactionOpSelection';

/** Expense parse (`deviceParseUnsafe`) — pinned to the measured order. The
 *  schema depends on the text (step 3): `plan` says whether the amount is left
 *  to code, narrowed to a closed choice, or free (src/domain/fmParse.ts). */
export function deviceParseSchemaFor(plan: FmAmountPlan): Schema<Record<string, unknown>> {
  return orderedJsonSchema(fmParseSchemaFor(plan), fieldOrderFor(plan));
}

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
