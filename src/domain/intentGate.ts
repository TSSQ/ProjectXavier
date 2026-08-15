/**
 * The unified intent gate — composes every deterministic intent domain in
 * the SAME order `runParse` (app/(tabs)/index.tsx) applies them, so the
 * intent-corpus suite (tests/__steps__/intent-corpus.steps.ts) exercises
 * exactly the routing decision the app makes, not each gate in isolation.
 *
 * Order: the QUERY gate runs FIRST (docs/design/ask-xavier-queries-spec.md
 * §5.1), then the account gate, then the transaction-OP candidacy gate
 * (docs/design/chat-transaction-delete-update-spec.md §5.1), then
 * (implicitly, by returning `null`) the expense ladder. A query-shaped lead
 * always wins even when the tail could also satisfy the account gate (see
 * the intent-corpus case "show me how to add an account"); an account-shaped
 * hit always wins over the tx_op gate even when the tail could also satisfy
 * it (see "delete my savings account" vs "delete my last transaction").
 */
import { detectQueryIntent } from './queryIntent';
import { detectAccountIntent } from './accountIntent';
import { detectTransactionOpCandidate } from './transactionOpIntent';

export type UnifiedIntent = 'create' | 'update' | 'delete' | 'query' | 'tx_op' | null;

/**
 * Classify `text` into the single intent domain `runParse` would route to:
 * `'query'` (Ask-Xavier), `'create'`/`'update'`/`'delete'` (the account
 * gate), `'tx_op'` (chat transaction delete/update — the model never
 * identifies the row, the user picks it), or `null` (falls through to the
 * expense ladder). `forceExpense` mirrors the `/transactions` bypass, which
 * skips every gate — including this one — exactly like it already skips
 * `detectAccountIntent` alone.
 */
export function detectIntent(text: string, options?: { forceExpense?: boolean }): UnifiedIntent {
  if (options?.forceExpense) return null;
  if (detectQueryIntent(text)) return 'query';
  const accountIntent = detectAccountIntent(text);
  if (accountIntent) return accountIntent.op;
  if (detectTransactionOpCandidate(text)) return 'tx_op';
  return null;
}
