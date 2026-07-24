/**
 * Account data access. All reads/writes go through Drizzle, which emits
 * parameterised statements.
 */
import { eq, or, inArray } from 'drizzle-orm';
import { db, expoDb } from '../../db/client';
import { accounts, transactions, recurringSeries } from '../../db/schema';
import { Account } from '../../domain/types';
import { runExclusive } from '../../domain/backupGate';
import {
  runAccountDeleteCascade,
  AccountDeleteDriver,
} from '../../domain/accountDeleteCascade';
import {
  computeAccountDeleteImpact,
  AccountDeleteImpact,
} from '../../domain/accountDeleteImpact';
import { listTransactions } from '../transactions/repository';
import { listSeries } from '../recurring/repository';
import { updateWidgetSummary } from '../widget/summary';
// `createBackupUnlocked` creates a deliberate two-file import cycle with
// backup/repository.ts (which imports `listAccounts` from this file) — see
// that export's own header comment for why this is safe.
import { createBackupUnlocked } from '../backup/repository';

export async function listAccounts(): Promise<Account[]> {
  const rows = await db.select().from(accounts);
  return rows.map(rowToAccount);
}

export async function getAccount(id: string): Promise<Account | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return rows[0] ? rowToAccount(rows[0]) : null;
}

export async function createAccount(account: Account): Promise<void> {
  await db.insert(accounts).values({
    id: account.id,
    name: account.name,
    tag: account.tag ?? null,
    subtype: account.subtype ?? null,
    icon: account.icon ?? null,
    currency: account.currency,
    openingBalance: account.openingBalance,
    archived: account.archived ?? false,
  });
}

export async function updateAccount(account: Account): Promise<void> {
  await db
    .update(accounts)
    .set({
      name: account.name,
      tag: account.tag ?? null,
      subtype: account.subtype ?? null,
      icon: account.icon ?? null,
      currency: account.currency,
      openingBalance: account.openingBalance,
      archived: account.archived ?? false,
    })
    .where(eq(accounts.id, account.id));
}

/**
 * Hard-delete an account and every transaction/recurring-series row that
 * references it, PERMANENTLY (docs/design/account-chat-crud-spec.md §5.4).
 * This is the ONLY place the cascade primitive is wired to the real
 * database — reachable ONLY from the manage-accounts screen's typed-name
 * confirm sheet (§5.5); chat NEVER calls this (§5.3 — recognize + handoff
 * only). Returns the impact that was deleted, so the caller can show what
 * just happened.
 *
 * Sequence, all inside ONE `runExclusive` section (H1 — never interleaves
 * with a concurrent backup/restore snapshot, both of which touch the SAME
 * shared `expoDb` connection):
 *  1. Snapshot the impact (read-only, informational — returned to the
 *     caller for display) from the current, still-intact data.
 *  2. Force a pre-delete backup via `createBackupUnlocked` (the F3 backup
 *     machinery, unconditionally — never throttled/skipped like the
 *     opportunistic auto-backup), so CLAUDE.md guardrail #1's round-trip can
 *     restore the pre-delete world.
 *  3. Run the actual destructive delete in ONE `expoDb` transaction
 *     (`runAccountDeleteCascade` — rolls back completely on any failure).
 *     Recurring series are deleted via a LIVE lookup at delete time (QA
 *     MINOR: TOCTOU fix), never the id list from step 1 — a series created
 *     during step 2's (real I/O, potentially slow) backup window must not
 *     survive referencing a deleted account.
 *  4. Recompute the widget summary — the live dataset just changed under its
 *     feet (mirrors `applyBackupUnlocked`'s same last step).
 */
export async function deleteAccountCascade(accountId: string): Promise<AccountDeleteImpact> {
  return runExclusive(async () => {
    const [txs, series] = await Promise.all([listTransactions(), listSeries()]);
    const impact = computeAccountDeleteImpact(accountId, txs, series);

    const driver: AccountDeleteDriver = {
      forcePreDeleteBackup: createBackupUnlocked,
      transaction: (fn) => expoDb.withTransactionAsync(fn),
      deleteTransactionsForAccount: async (id) => {
        await db
          .delete(transactions)
          .where(or(eq(transactions.accountId, id), eq(transactions.transferAccountId, id)));
      },
      // Live read + filter + delete, evaluated INSIDE the transaction — not
      // the pre-snapshotted `impact.recurringSeriesIds` — so a series
      // created during step 2's backup window is still caught (TOCTOU fix).
      // `template` is stored as JSON text (no queryable column for
      // accountId/transferAccountId), so this reads every row back into JS
      // rather than a SQL WHERE on the JSON content.
      deleteRecurringSeriesReferencingAccount: async (id) => {
        const rows = await db
          .select({ id: recurringSeries.id, template: recurringSeries.template })
          .from(recurringSeries);
        const matchingIds = rows
          .filter((r) => {
            try {
              const tpl = JSON.parse(r.template) as {
                accountId?: string;
                transferAccountId?: string | null;
              };
              return tpl.accountId === id || tpl.transferAccountId === id;
            } catch {
              return false;
            }
          })
          .map((r) => r.id);
        if (matchingIds.length === 0) return;
        await db.delete(recurringSeries).where(inArray(recurringSeries.id, matchingIds));
      },
      deleteAccountRow: async (id) => {
        await db.delete(accounts).where(eq(accounts.id, id));
      },
    };

    await runAccountDeleteCascade(driver, accountId);

    void updateWidgetSummary();
    return impact;
  });
}

function rowToAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag ?? null,
    subtype: row.subtype ?? undefined,
    icon: row.icon ?? null,
    currency: row.currency,
    openingBalance: row.openingBalance,
    archived: row.archived,
  };
}
