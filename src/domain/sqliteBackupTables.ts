/**
 * Pure table-name constants + validation for the plaintext-SQLite backup
 * format (assessment M3). No React Native / Expo / DB imports — Node-testable
 * (the native ATTACH/read glue that uses these lives in
 * src/features/backup/sqliteFile.ts).
 *
 * Table names here are literal SQL identifiers — compile-time constants,
 * never derived from user/backup-file input — so interpolating them into
 * DDL/DML does not touch the parameterised-SQL guardrail (identifiers can't
 * be bound as `?` params anyway; see src/db/migrationPlan.ts for the existing
 * precedent of the same pattern).
 *
 * Restore no longer copies rows with raw SQL (`INSERT INTO x SELECT * FROM
 * src.x`) — every row is read, mapped, and zod-validated in JS first (see
 * src/domain/sqliteBackupRows.ts) and then handed to the EXISTING
 * `applyBackup`, which already knows the FK-safe delete/insert order for the
 * 5 domain tables (see src/features/backup/repository.ts). `SQL_TABLES` here
 * is just the list of tables a valid backup file must contain — order is not
 * meaningful for reading.
 */

/** All 6 backed-up tables. `parse_metrics` is deliberately excluded — see
 *  src/features/backup/sqliteFile.ts's export step. */
export const SQL_TABLES = [
  'accounts',
  'categories',
  'payees',
  'settings',
  'transactions',
  'recurring_series',
] as const;

/**
 * Returns which of the expected tables are absent from `actualTables` (e.g.
 * the table names found in an attached backup file via `sqlite_master`).
 * Used to reject an obviously foreign/corrupt `.sqlite` file BEFORE any live
 * data is wiped, rather than discovering the mismatch mid-restore.
 */
export function missingTables(actualTables: string[]): string[] {
  const present = new Set(actualTables);
  return SQL_TABLES.filter((t) => !present.has(t));
}
