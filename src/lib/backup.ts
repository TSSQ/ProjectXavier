/**
 * Backup serialisation / deserialisation (plaintext JSON) — LEGACY.
 *
 * Assessment M3 moved new backups to a whole-DB plaintext SQLite image (see
 * src/features/backup/sqliteFile.ts); `serializeBackup`/`parseBackup` here
 * are kept ONLY so a `.json` backup written before that change still
 * restores. No code path writes a new `.json` backup anymore.
 *
 * Backups (both formats) are stored unencrypted in the app's iCloud
 * Documents container. At-rest confidentiality is provided by iCloud's own
 * encryption and the user's device lock (the live local DB is separately
 * SQLCipher-encrypted at rest — independent of backup confidentiality). See
 * docs/adr/0006-icloud-unencrypted-backups.md.
 *
 * Version history:
 *   2 — plaintext JSON, adds recurringSeries (this format; restore-only)
 *   3 — plaintext SQLite whole-DB image (current; see sqliteFile.ts)
 */
import { Account, Category, Payee, Transaction, RecurringSeries } from '../domain/types';

export const BACKUP_VERSION = 2 as const;

export interface BackupData {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  transactions: Transaction[];
  recurringSeries: RecurringSeries[];
  /** App-level preferences (e.g. { currency: "SGD" }). Optional for backward
   *  compatibility with any legacy `.json` backup that predates the settings
   *  store. */
  settings?: Record<string, string>;
}

export interface BackupEnvelope {
  version: number;
  exportedAt: number;
  data: BackupData;
}

/**
 * Serialise a dataset to a JSON string ready for storage.
 * @param data  The full dataset to back up.
 * @param now   Timestamp to embed (ms since epoch). Defaults to Date.now().
 */
export function serializeBackup(data: BackupData, now: number = Date.now()): string {
  const envelope: BackupEnvelope = {
    version: BACKUP_VERSION,
    exportedAt: now,
    data,
  };
  return JSON.stringify(envelope);
}

/**
 * Parse a JSON backup string back into an envelope.
 *
 * Throws if:
 *  - the JSON is malformed,
 *  - `version` is greater than 2 (unsupported future format — the current
 *    format, v3, is plaintext SQLite and never reaches this parser at all),
 *  - the data object is missing expected array fields, including
 *    `recurringSeries`.
 *
 * There is no version-1 handling: no confirmed real v1 (AES-encrypted)
 * backup file can exist (no public users predate this format, and KEEP=3
 * rotation would have pruned any that did), so a v1-shaped payload is simply
 * rejected by the `recurringSeries` check below like any other malformed
 * input, rather than special-cased.
 */
export function parseBackup(json: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Backup is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Backup is malformed: expected an object');
  }

  const env = parsed as Record<string, unknown>;

  if (typeof env['version'] !== 'number') {
    throw new Error('Backup is malformed: missing version');
  }

  const version = env['version'] as number;

  if (version > 2) {
    throw new Error(`Unsupported backup version: ${version}. This version of the app supports up to version 2.`);
  }

  if (typeof env['exportedAt'] !== 'number') {
    throw new Error('Backup is malformed: missing exportedAt');
  }

  if (typeof env['data'] !== 'object' || env['data'] === null) {
    throw new Error('Backup is malformed: missing data');
  }

  const data = env['data'] as Record<string, unknown>;

  // Validate the required array fields are present.
  for (const field of ['accounts', 'categories', 'payees', 'transactions'] as const) {
    if (!Array.isArray(data[field])) {
      throw new Error(`Backup is malformed: data.${field} is not an array`);
    }
  }

  if (!Array.isArray(data['recurringSeries'])) {
    throw new Error('Backup is malformed: data.recurringSeries is not an array');
  }

  return {
    version,
    exportedAt: env['exportedAt'] as number,
    data: data as unknown as BackupData,
  };
}
