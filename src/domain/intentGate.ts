/**
 * The unified intent gate — composes every deterministic intent domain in
 * the SAME order `runParse` (app/(tabs)/index.tsx) applies them, so the
 * intent-corpus suite (tests/__steps__/intent-corpus.steps.ts) exercises
 * exactly the routing decision the app makes, not each gate in isolation.
 *
 * Order: the BUDGET gate (afford / set / edit / remove budget, docs/design/monthly-budgets-spec.md
 * §6.1) is acted on first in `runParse`, then the QUERY gate runs (docs/design/ask-xavier-queries-spec.md
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
import { detectBudgetIntent } from './budgetIntent';
import { budgetFmCandidate } from './budgetFm';
import { Category } from './types';

export type UnifiedIntent =
  | 'create'
  | 'update'
  | 'delete'
  | 'query'
  | 'tx_op'
  | 'afford'
  | 'set_budget'
  | 'edit_budget'
  | 'remove_budget'
  | 'budget_clarify'
  | 'budget_model'
  | null;

/**
 * Classify `text` into the single intent domain `runParse` would route to:
 * `'query'` (Ask-Xavier), `'create'`/`'update'`/`'delete'` (the account
 * gate), `'tx_op'` (chat transaction delete/update — the model never
 * identifies the row, the user picks it), `'budget_model'` (budget wording
 * only the model fallback may read; checked last), or `null` (falls through to the
 * expense ladder). `forceExpense` mirrors the `/transactions` bypass, which
 * skips every gate — including this one — exactly like it already skips
 * `detectAccountIntent` alone.
 */
export function detectIntent(
  text: string,
  options?: { forceExpense?: boolean; categories?: Category[] }
): UnifiedIntent {
  if (options?.forceExpense) return null;
  // The budget gate (monthly-budgets spec §6.1): in runParse it is acted on
  // BEFORE the query gate, so it is checked first here too. `categories`
  // matters only to the verbless set-budget forms ("groceries budget 450"),
  // which route only for an existing category.
  const budget = detectBudgetIntent(text, options?.categories);
  if (budget) {
    switch (budget.kind) {
      case 'afford':
        return 'afford';
      case 'set-budget':
        return 'set_budget';
      case 'edit-budget':
        return 'edit_budget';
      case 'remove-budget':
        return 'remove_budget';
      case 'budget-clarify':
        return 'budget_clarify';
    }
  }
  if (detectQueryIntent(text)) return 'query';
  const accountIntent = detectAccountIntent(text);
  if (accountIntent) return accountIntent.op;
  if (detectTransactionOpCandidate(text)) return 'tx_op';
  // LAST, after every gate above has declined: wording the budget router did
  // not read, which the on-device model may fill (budgetFallback). It must
  // never pre-empt a query ("show me how much is left in my food budget").
  if (budgetFmCandidate(text, options?.categories)) return 'budget_model';
  return null;
}
