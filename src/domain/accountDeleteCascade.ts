/**
 * DB-agnostic account-delete cascade algorithm — mirrors `migrationPlan.ts`'s
 * split (docs/design/account-chat-crud-spec.md §5.4): the minimal
 * `AccountDeleteDriver` interface a SQLite driver must satisfy, and the one
 * `runAccountDeleteCascade` algorithm that runs against ANY driver.
 * Production wires this to Drizzle/expo-sqlite (see
 * src/features/accounts/repository.ts's `deleteAccountCascade`, which is NOT
 * Node-testable — it imports the native DB client); the plain-Node BDD suite
 * wires it to `node:sqlite`, so the EXACT same algorithm — same ordering, same
 * transaction/rollback semantics — runs against a real SQLite engine in
 * tests, not a hand-rolled fake.
 *
 * Sequence (spec §5.4), NOT itself wrapped in a single SQL transaction end to
 * end — a forced backup is file I/O (an iCloud upload in production), which
 * can't be part of a SQLite `BEGIN`/`COMMIT`:
 *  1. `forcePreDeleteBackup()` — a forced snapshot BEFORE any destructive
 *     statement runs, so CLAUDE.md guardrail #1's round-trip can restore the
 *     pre-delete world even if the delete itself succeeds. Runs unconditionally,
 *     never skipped/throttled the way the opportunistic auto-backup is.
 *  2. `transaction(fn)` — the actual destructive delete, wrapped in ONE
 *     database transaction (parameterised, guardrail #4): delete every
 *     transaction row referencing the account, delete the recurring series
 *     LIVE-referencing it, delete the account row itself. A throw anywhere in
 *     `fn` rolls back the WHOLE transaction — no partial delete is ever left
 *     behind.
 *
 * TOCTOU fix (QA MINOR follow-up): recurring series are deleted via a driver
 * method that re-reads which series reference the account INSIDE the
 * transaction (`deleteRecurringSeriesReferencingAccount`) — NEVER a fixed id
 * list snapshotted before step 1's (potentially slow, real I/O) backup. A
 * series created during that backup window still gets caught, because the
 * "which series reference this account" decision happens live, at delete
 * time, not at snapshot time.
 */

export interface AccountDeleteDriver {
  /** Forced pre-delete backup/snapshot — MUST resolve before any destructive
   *  statement runs. Never skipped, unlike the opportunistic auto-backup. */
  forcePreDeleteBackup(): Promise<void>;
  /** Runs `fn` inside ONE database transaction; a throw from `fn` rolls back
   *  every statement `fn` issued. */
  transaction(fn: () => Promise<void>): Promise<void>;
  /** Deletes every transaction row where `account_id = accountId` OR
   *  `transfer_account_id = accountId` — parameterised, never string-built. */
  deleteTransactionsForAccount(accountId: string): Promise<void>;
  /** Deletes every recurring-series row that CURRENTLY (live, evaluated
   *  inside the transaction — see the module header's TOCTOU note)
   *  references `accountId`, as either its own account or its transfer
   *  destination. A no-op when none do. */
  deleteRecurringSeriesReferencingAccount(accountId: string): Promise<void>;
  /** Deletes the account row itself. */
  deleteAccountRow(accountId: string): Promise<void>;
}

/**
 * Runs the account-delete cascade against any `AccountDeleteDriver` — the
 * single implementation of the algorithm; production and the plain-Node test
 * suite both call this, just with different drivers, so there is no separate
 * "test copy" to drift out of sync (mirrors `runMigrations`).
 */
export async function runAccountDeleteCascade(
  driver: AccountDeleteDriver,
  accountId: string
): Promise<void> {
  await driver.forcePreDeleteBackup();
  await driver.transaction(async () => {
    await driver.deleteTransactionsForAccount(accountId);
    await driver.deleteRecurringSeriesReferencingAccount(accountId);
    await driver.deleteAccountRow(accountId);
  });
}
