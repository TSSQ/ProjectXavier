/**
 * Leaf constant for the account-update operations: no imports, so the chat log
 * schemas needn't pull in the `ai` package via accountUpdateSchema.ts.
 * Re-exported from there.
 */
export const ACCOUNT_UPDATE_OPERATIONS = ['rename', 'retype', 'rebalance', 'unknown'] as const;
export type AccountUpdateOperation = (typeof ACCOUNT_UPDATE_OPERATIONS)[number];
