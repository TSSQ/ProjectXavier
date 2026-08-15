/**
 * Account archive / restore — pure helpers behind the manage-accounts
 * screen's restore path (docs/design/account-archive-restore-spec.md
 * §5.1/§5.2). Framework-free so this runs in the plain-Node BDD suite.
 *
 * `Account.archived` is optional (`archived?: boolean`), so every check here
 * treats `undefined` the same as `false` (active) — never assume it's set.
 */
import { Account } from './types';
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
