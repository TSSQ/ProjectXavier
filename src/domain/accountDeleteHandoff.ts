/**
 * Chat delete HANDOFF message — docs/design/account-chat-crud-spec.md §5.3.
 * "delete my DBS account" is RECOGNIZED (the gate + `findAccountMatch`
 * resolve it), but chat NEVER executes the cascade: this builds the reply
 * naming the impact (including the cross-account effect — never hidden, see
 * accountDeleteImpact.ts's header) and a deep-link route to manage-accounts
 * with the account pre-selected, where the ONLY actual delete trigger lives
 * (the typed-name-confirm sheet, app/manage-accounts.tsx).
 *
 * Pure and framework-free — does not import expo-router or call anything
 * destructive; the caller (app/(tabs)/index.tsx) owns actually navigating.
 */
import { Account } from './types';
import { AccountDeleteImpact } from './accountDeleteImpact';

export interface AccountDeleteHandoff {
  /** The chat reply naming the impact — never omits the cross-account
   *  effect when one exists. */
  message: string;
  /** expo-router path to manage-accounts with this account pre-selected for
   *  the destructive-delete sheet (NOT auto-opened — the user still has to
   *  tap "Delete permanently" and type the name there). */
  deepLink: string;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Build the delete handoff for `account`, given its precomputed
 * `impact` (src/domain/accountDeleteImpact.ts) and the full account list (for
 * resolving counterparty names in the message — ids alone aren't user-facing).
 */
export function buildAccountDeleteHandoff(
  account: Account,
  impact: AccountDeleteImpact,
  allAccounts: Account[]
): AccountDeleteHandoff {
  const counterpartyNames = impact.counterpartyAccountIds
    .map((id) => allAccounts.find((a) => a.id === id)?.name)
    .filter((name): name is string => !!name);

  const parts = [`Deleting **${account.name}** permanently removes ${plural(impact.transactionCount, 'transaction')}`];

  if (impact.transferCount > 0) {
    const transferNote =
      counterpartyNames.length > 0
        ? `incl. ${plural(impact.transferCount, 'transfer')} with ${counterpartyNames.join(', ')}, which changes ${
            counterpartyNames.length === 1 ? "its" : "their"
          } balance`
        : `incl. ${plural(impact.transferCount, 'transfer')}`;
    parts[0] = `${parts[0]} (${transferNote})`;
  }

  if (impact.recurringSeriesIds.length > 0) {
    parts.push(
      `${plural(impact.recurringSeriesIds.length, 'recurring rule')} referencing it will be removed too`
    );
  }

  parts.push('Archive instead keeps everything — open Accounts to delete permanently, or archive there.');

  return {
    // Every element up to the last already reads as a clause (no trailing
    // period); the final element ("Archive instead...") is a full sentence.
    message: parts.join('. '),
    deepLink: `/manage-accounts?deleteAccountId=${encodeURIComponent(account.id)}`,
  };
}
