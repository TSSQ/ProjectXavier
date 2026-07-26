/**
 * Account-delete impact — the pure "what would this destroy" calculation
 * shared by the chat delete HANDOFF (docs/design/account-chat-crud-spec.md
 * §5.3 — recognize + never execute) and the manage-accounts screen's delete
 * sheet (§5.5 — the ONLY place the cascade actually runs). Operates on
 * already-loaded `Transaction[]`/`RecurringSeries[]` arrays (the repository
 * layer already has `listTransactions()`/`listSeries()` for this), so it
 * needs no database access at all and is fully BDD-testable in plain Node.
 *
 * "Transfers are a single row" (spec §2): a transfer where this account is
 * either `accountId` or `transferAccountId` touches BOTH accounts' balances
 * off the very same row (`src/domain/balances.ts`), so deleting the row IS
 * "delete both sides" — `counterpartyAccountIds` names every OTHER account
 * whose balance changes as a result, which is what the chat handoff and the
 * screen sheet must both disclose, never hide.
 */
import { Transaction, RecurringSeries } from './types';

export interface AccountDeleteImpact {
  /** Every transaction that references this account, either as the primary
   *  `accountId` or as a transfer's `transferAccountId` — exactly what
   *  `deleteAccountCascade` deletes. */
  transactionCount: number;
  /** Subset of `transactionCount` that are transfers touching this account
   *  (either side). */
  transferCount: number;
  /** Distinct OTHER account ids whose balance changes because a transfer
   *  between them and this account is about to be deleted — the cross-
   *  account effect that must always be disclosed, never silent (spec §5.4). */
  counterpartyAccountIds: string[];
  /** Recurring series that would post into a void afterwards unless removed
   *  along with the account (referencing it as either the series' own
   *  account or its transfer destination). */
  recurringSeriesIds: string[];
}

function referencesAccount(tx: Transaction, accountId: string): boolean {
  return tx.accountId === accountId || tx.transferAccountId === accountId;
}

/** Compute the impact of deleting `accountId`, given the full transaction and
 *  recurring-series lists. Never touches a database — pure data in, pure
 *  data out. */
export function computeAccountDeleteImpact(
  accountId: string,
  transactions: Transaction[],
  recurringSeries: RecurringSeries[]
): AccountDeleteImpact {
  const touching = transactions.filter((tx) => referencesAccount(tx, accountId));
  const transfers = touching.filter((tx) => tx.type === 'transfer');

  const counterparties = new Set<string>();
  for (const tx of transfers) {
    if (tx.accountId === accountId && tx.transferAccountId && tx.transferAccountId !== accountId) {
      counterparties.add(tx.transferAccountId);
    } else if (tx.transferAccountId === accountId && tx.accountId !== accountId) {
      counterparties.add(tx.accountId);
    }
  }

  const referencingSeries = recurringSeries.filter(
    (s) => s.template.accountId === accountId || s.template.transferAccountId === accountId
  );

  return {
    transactionCount: touching.length,
    transferCount: transfers.length,
    counterpartyAccountIds: [...counterparties],
    recurringSeriesIds: referencingSeries.map((s) => s.id),
  };
}
