/**
 * The unified intent gate — composes every deterministic intent domain in
 * the SAME order `runParse` (app/(tabs)/index.tsx) applies them, so the
 * intent-corpus suite (tests/__steps__/intent-corpus.steps.ts) exercises
 * exactly the routing decision the app makes, not each gate in isolation.
 *
 * Order (docs/design/ask-xavier-queries-spec.md §5.1): the QUERY gate runs
 * FIRST, then the account gate, then (implicitly, by returning `null`) the
 * expense ladder. A query-shaped lead always wins even when the tail could
 * also satisfy the account gate (see the intent-corpus case "show me how to
 * add an account").
 */
import { detectQueryIntent } from './queryIntent';
import { detectAccountIntent } from './accountIntent';

export type UnifiedIntent = 'create' | 'update' | 'delete' | 'query' | null;

/**
 * Classify `text` into the single intent domain `runParse` would route to:
 * `'query'` (Ask-Xavier), `'create'`/`'update'`/`'delete'` (the account
 * gate), or `null` (falls through to the expense ladder). `forceExpense`
 * mirrors the `/transactions` bypass, which skips every gate — including
 * this one — exactly like it already skips `detectAccountIntent` alone.
 */
export function detectIntent(text: string, options?: { forceExpense?: boolean }): UnifiedIntent {
  if (options?.forceExpense) return null;
  if (detectQueryIntent(text)) return 'query';
  const accountIntent = detectAccountIntent(text);
  return accountIntent ? accountIntent.op : null;
}
