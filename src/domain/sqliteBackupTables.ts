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

/** Tables a backup MAY contain: read when present, never required, so an
 *  image taken before the table existed still restores (it has no budgets). */
export const OPTIONAL_SQL_TABLES = ['budgets'] as const;

/** Tables stripped from the exported image right after `sqlcipher_export`
 *  (it has no per-table exclude, so we export everything, then delete):
 *  `parse_metrics` (diagnostics) and `chat_messages` (today's chat, which
 *  describes data a restore may replace — docs/design/xavier-daily-chat-spec.md
 *  §5). Neither is in SQL_TABLES/OPTIONAL_SQL_TABLES, so restore never reads or
 *  writes them; the restore itself clears the chat (applyBackupUnlocked). */
export const EXPORT_STRIPPED_TABLES = ['parse_metrics', 'chat_messages'] as const;

/** `DELETE FROM <schema>.<table>;` for each stripped table. `schema` is a
 *  compile-time alias ('plain'), never user input. */
export function stripExportSql(schema: string): string {
  return EXPORT_STRIPPED_TABLES.map((t) => `DELETE FROM ${schema}.${t};`).join('\n       ');
}

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
