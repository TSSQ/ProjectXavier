/**
 * SQLCipher plaintext-snapshot glue for backup create/restore (assessment M3;
 * restore path fixed after QA Blocker/Major — see readBackupDataFromAttached).
 *
 * Backup create uses SQLCipher's `sqlcipher_export` to produce a PLAINTEXT
 * SQLite file from the keyed live connection (`KEY ''` = no encryption on the
 * attached copy) — a whole-database image, so a newly added column can never
 * silently go missing the way the old per-row JSON serialiser
 * (`gatherBackupData` in repository.ts) could. `parse_metrics` (diagnostics —
 * already excluded from the legacy JSON backup) is deliberately dropped from
 * the exported copy afterwards; see `exportPlaintextSnapshot`.
 *
 * Restore re-attaches a downloaded plaintext `.sqlite` file to the SAME keyed
 * live connection, reads every row of every table back into JS, and
 * validates it through the existing zod schemas (see
 * src/domain/sqliteBackupRows.ts) BEFORE any live data is touched — it does
 * NOT do a raw `INSERT ... SELECT *` copy: SQLite has no strict column
 * typing, so that would silently commit e.g. `amount = 'NOT_A_NUMBER'` into
 * the live DB with no error (the QA-reproduced Blocker). The validated result
 * is handed to the EXISTING `applyBackup`/`applyBackupUnlocked`
 * (src/features/backup/repository.ts) — the same wipe-and-reinsert-by-named-
 * column function the legacy `.json` restore path already uses, which also
 * tolerates a backup taken on an older schema with fewer columns (the QA
 * Major) since it inserts by name, not by position.
 *
 * This file imports expo-file-system (for scratch-file paths) and expo-sqlite
 * types only — it is native, NOT Node-testable. The pure pieces (row mapping,
 * zod validation, table-name checks) live in src/domain/sqliteBackupRows.ts
 * and src/domain/sqliteBackupTables.ts and ARE Node-tested; this file's own
 * ATTACH/read plumbing is exercised by the sim smoke test (see the spec).
 */
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { BackupData } from '../../lib/backup';
import { BACKUP_BOOKKEEPING_SETTINGS_KEYS } from '../../domain/backupPolicy';
import { SQL_TABLES, missingTables } from '../../domain/sqliteBackupTables';
import { RawBackupRows, RawRow, buildBackupDataFromRows } from '../../domain/sqliteBackupRows';

/** Scratch files live in the cache directory: never iCloud-synced, never
 *  meant to outlive a single create/restore call, safe for the OS to purge
 *  under storage pressure between runs (each call deletes its own file when
 *  done, and clears any stale leftover from an interrupted previous run
 *  before starting). */
function scratchFile(name: string): File {
  return new File(Paths.cache, name);
}

/**
 * Strip the `file://` prefix expo-file-system's `File.uri` returns. Both
 * ATTACH DATABASE (a raw SQLite/SQLCipher statement) and
 * react-native-cloud-storage's `uploadFile`/`downloadFile` (which pass the
 * local path straight to `URL(fileURLWithPath:)`) want a plain filesystem
 * path, not a `file://` URI. Mirrors the equivalent conversion in
 * src/db/client.ts's `sqliteDir()`.
 */
export function toSqlitePath(fileUri: string): string {
  return fileUri.startsWith('file://') ? fileUri.slice('file://'.length) : fileUri;
}

/** Escape a path for embedding inside a single-quoted SQL string literal
 *  (ATTACH DATABASE takes a string literal, not a bound parameter — SQLite
 *  has no placeholder support for ATTACH's filename). The path itself is
 *  built by this file, never from backup-file/user content, so this is a
 *  defensive measure (a stray `'` in a device path), not an injection guard
 *  for untrusted input. */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** A local scratch path for a backup currently being created. */
export function backupScratchFile(exportedAt: number): File {
  return scratchFile(`projectxavier-backup-${exportedAt}.sqlite`);
}

/**
 * A local scratch path for a backup currently being restored. Takes a
 * caller-supplied unique `token` (rather than a fixed name) so two restores
 * kicked off close together never race on the same download destination —
 * `downloadFile` throws if its destination already exists.
 */
export function restoreScratchFile(token: string): File {
  return scratchFile(`projectxavier-restore-${token}.sqlite`);
}

/** Deletes `file` if present — safe to call whether or not it exists. Used
 *  both to clear a stale leftover before a download/export and to clean up
 *  after one, so a crash between runs never leaves a growing pile of scratch
 *  files (the cache dir also gets reclaimed by the OS regardless). */
export function deleteScratchFileIfExists(file: File): void {
  if (file.exists) file.delete();
}

/**
 * Exports a PLAINTEXT SQLite snapshot of the (keyed) live database to `file`
 * via SQLCipher's `sqlcipher_export`. `KEY ''` attaches the destination with
 * NO encryption — the resulting file opens with no key at all (verify: a
 * hexdump of the header reads `SQLite format 3\0`, not random bytes).
 *
 * Two things are stripped from the exported copy right after the export,
 * before anyone reads or uploads it (neither has a per-table include/exclude
 * option on `sqlcipher_export` itself, so the only way to honour them for a
 * whole-DB image is to export everything, then delete):
 *  - `parse_metrics` (content-free parse diagnostics, prod-inert) — already
 *    "deliberately excluded from backups" for the legacy JSON format (see
 *    src/db/schema.ts).
 *  - The `backup_last_sig`/`backup_last_at` bookkeeping rows in `settings`
 *    (`BACKUP_BOOKKEEPING_SETTINGS_KEYS`) — the legacy JSON path already
 *    strips these (`gatherBackupData`); without stripping them here too, a
 *    `.sqlite` restore would re-seed stale bookkeeping and trigger one
 *    spurious extra auto-backup right after restore.
 *
 * ATTACH runs on its own (outside any try/finally — if it fails, nothing was
 * attached, so there's nothing to release). The export + deletes are wrapped
 * in try/finally so DETACH always runs, even if `sqlcipher_export` itself
 * throws: `plain` is attached on `expoDb`, the long-lived shared connection
 * singleton — an unreleased attachment would make EVERY subsequent
 * `createBackup` fail with "database plain is already in use" until app
 * restart, i.e. one export failure would otherwise break all future backups.
 */
export async function exportPlaintextSnapshot(expoDb: SQLiteDatabase, file: File): Promise<void> {
  const path = escapeSqlLiteral(toSqlitePath(file.uri));
  await expoDb.execAsync(`ATTACH DATABASE '${path}' AS plain KEY '';`);
  try {
    const bookkeepingKeys = BACKUP_BOOKKEEPING_SETTINGS_KEYS.map(
      (k) => `'${escapeSqlLiteral(k)}'`,
    ).join(', ');
    await expoDb.execAsync(
      `SELECT sqlcipher_export('plain');
       DELETE FROM plain.parse_metrics;
       DELETE FROM plain.settings WHERE key IN (${bookkeepingKeys});`,
    );
  } finally {
    // Best-effort cleanup: if the export itself failed, there's nothing to
    // roll back (the destination file is just discarded by the caller), but
    // the attachment on `expoDb` MUST be released either way — see above.
    await expoDb.execAsync(`DETACH DATABASE plain;`).catch(() => undefined);
  }
}

/**
 * Attaches a downloaded plaintext `.sqlite` backup (`file`) to the live
 * (keyed) connection and reads every row of every expected table back into
 * JS, returning a validated `BackupData` — it does NOT touch any live table.
 *
 * MUST be called from inside the existing H1 exclusivity gate
 * (`src/domain/backupGate.ts`'s `runExclusive`, see
 * src/features/backup/repository.ts), same as the JSON restore path, because
 * ATTACH/read/DETACH share the same connection a concurrent auto-backup
 * could otherwise interleave with.
 *
 * Guards against an obviously-wrong file (foreign/corrupt `.sqlite`) up
 * front: if `src` is missing one of the expected tables, this throws before
 * reading anything (ATTACH itself succeeds for any valid SQLite file, so it
 * can't catch this on its own). Every row of every table is then validated
 * through the existing zod schemas (`buildBackupDataFromRows`) — a single
 * invalid row throws and aborts the WHOLE restore before the caller ever
 * calls `applyBackup`, so no live data is wiped.
 */
export async function readBackupDataFromAttached(
  expoDb: SQLiteDatabase,
  file: File,
): Promise<BackupData> {
  const path = escapeSqlLiteral(toSqlitePath(file.uri));
  await expoDb.execAsync(`ATTACH DATABASE '${path}' AS src KEY '';`);
  try {
    const tableRows = await expoDb.getAllAsync<{ name: string }>(
      `SELECT name FROM src.sqlite_master WHERE type = 'table';`,
    );
    const missing = missingTables(tableRows.map((r) => r.name));
    if (missing.length > 0) {
      throw new Error(
        `Backup file is missing expected table(s): ${missing.join(', ')} — not a valid ProjectXavier backup.`,
      );
    }

    const rawRowsByTable = {} as RawBackupRows;
    for (const table of SQL_TABLES) {
      rawRowsByTable[table] = await expoDb.getAllAsync<RawRow>(`SELECT * FROM src.${table};`);
    }

    return buildBackupDataFromRows(rawRowsByTable);
  } finally {
    // Best-effort cleanup only — nothing has been written to the live DB by
    // this point (this function only reads); a failed DETACH just leaves the
    // attachment on the connection, harmless until the next restore
    // re-attaches under the same alias.
    await expoDb.execAsync(`DETACH DATABASE src;`).catch(() => undefined);
  }
}
