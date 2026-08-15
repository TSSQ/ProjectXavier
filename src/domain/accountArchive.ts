/**
 * Account archive / restore — pure helpers behind the manage-accounts
 * screen's restore path (docs/design/account-archive-restore-spec.md
 * §5.1/§5.2), plus the shared "Include archived" scope used by the Dashboard
 * and Transactions tab (§5.3/§5.3a). Framework-free so this runs in the
 * plain-Node BDD suite.
 *
 * `Account.archived` is optional (`archived?: boolean`), so every check here
 * treats `undefined` the same as `false` (active) — never assume it's set.
 */
import { Account, Transaction } from './types';
import { normalizeName } from './textMatch';
import { AccountDeleteImpact } from './accountDeleteImpact';

/**
 * Whether a single account matches a manage-accounts search query: name, tag
 * or subtype, case-insensitively; an empty (or whitespace-only) query matches
 * everything. Lifted verbatim (in behaviour) from the inline predicate that
 * used to live in app/manage-accounts.tsx's active-list search filter.
 */
export function matchesAccountQuery(account: Account, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [account.name, account.tag ?? '', account.subtype ?? ''].some((s) =>
    s.toLowerCase().includes(q)
  );
}

/**
 * Partitions `accounts` into active/archived for the manage-accounts screen,
 * applying `matchesAccountQuery` to both in the same single pass so search
 * filters both lists identically. Order is preserved from the input array.
 */
export function splitAccountsForManage(
  accounts: Account[],
  query: string
): { active: Account[]; archived: Account[] } {
  const active: Account[] = [];
  const archived: Account[] = [];
  for (const account of accounts) {
    if (!matchesAccountQuery(account, query)) continue;
    if (account.archived === true) {
      archived.push(account);
    } else {
      active.push(account);
    }
  }
  return { active, archived };
}

/** True when at least one account in `accounts` is archived — the archived
 *  section's render gate on manage-accounts, and (spec §5.3) the eventual
 *  dashboard "Include archived" toggle's render gate. */
export function hasArchivedAccounts(accounts: Account[]): boolean {
  return accounts.some((a) => a.archived === true);
}

/** Which action the edit sheet's header chip should offer for `account`:
 *  'unarchive' for an archived account, 'archive' otherwise — including when
 *  `archived` was never set. */
export function archiveActionFor(account: Account): 'archive' | 'unarchive' {
  return account.archived === true ? 'unarchive' : 'archive';
}

/**
 * True when some OTHER, currently-active account already normalises
 * (trim + collapse whitespace + lowercase) to the same name as `account` —
 * the restore-time name-collision check (spec §8.4: there's no uniqueness
 * constraint on `accounts.name`, so archiving "DBS", creating a new "DBS",
 * then restoring the first can leave two). Excludes `account` itself by id
 * and ignores other archived accounts sharing the name — an archived twin
 * isn't visible anywhere name resolution looks, so it can't collide.
 */
export function collidesWithActiveName(account: Account, accounts: Account[]): boolean {
  const target = normalizeName(account.name);
  return accounts.some(
    (a) => a.id !== account.id && a.archived !== true && normalizeName(a.name) === target
  );
}

/**
 * True when archiving is the better-recommended alternative to permanent
 * delete for the delete-confirm sheet (spec §5.8) — i.e. there's at least one
 * transaction that Archive would preserve and Delete would destroy. Consumes
 * the already-computed `AccountDeleteImpact` (from `computeAccountDeleteImpact`)
 * rather than re-loading transactions itself, so the recommendation and the
 * disclosed impact can never drift apart.
 */
export function recommendArchiveOverDelete(impact: AccountDeleteImpact): boolean {
  return impact.transactionCount > 0;
}

/**
 * Which accounts are in scope given the shared "Include archived" toggle
 * (spec §5.3/§5.3a): every account when `includeArchived`, active-only
 * otherwise. Both the dashboard (its account list, filter pills/sheet and
 * chart legend) and the Transactions tab (its ledger filter) derive their
 * scope from this single function, so "archived" means the same thing on
 * both screens instead of each one re-implementing its own filter.
 */
export function accountsInScope(accounts: Account[], includeArchived: boolean): Account[] {
  return includeArchived ? accounts : accounts.filter((a) => a.archived !== true);
}

/**
 * True when `tx` touches at least one account id in `visibleAccountIds` — via
 * its own `accountId`, or (for a transfer) its `transferAccountId`. This is
 * what the Transactions tab's archive filter (spec §5.3a) is built on: a
 * transfer with one archived leg and one visible leg must stay visible from
 * the visible leg's side (spec §8.2 — "the archived counterparty's name
 * still renders on the surviving account's rows: correct, do not hide it").
 * Checking `accountId` alone would make the row vanish whenever it happens to
 * be the archived leg — the same "checking only accountId would miss the
 * transfer case" mistake §5.7 calls out for the dangling-reference scan.
 */
export function isTransactionVisible(
  tx: Transaction,
  visibleAccountIds: ReadonlySet<string>
): boolean {
  return (
    visibleAccountIds.has(tx.accountId) ||
    (!!tx.transferAccountId && visibleAccountIds.has(tx.transferAccountId))
  );
}
