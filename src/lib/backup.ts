/**
 * Backup serialisation / deserialisation (plaintext JSON).
 *
 * Backups are stored unencrypted in the app's iCloud Documents container.
 * At-rest confidentiality is provided by iCloud's own encryption and the
 * user's device lock. See docs/adr/0006-icloud-unencrypted-backups.md.
 *
 * Version history:
 *   1 — original (AES-256-GCM encrypted, no recurringSeries)
 *   2 — plaintext JSON, adds recurringSeries
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
   *  compatibility with v1 backups that predate the settings store. */
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
 *  - `version` is greater than 2 (unsupported future format),
 *  - the data object is missing expected array fields.
 *
 * Version-1 backups (no recurringSeries) are normalised to `recurringSeries: []`.
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

  // Version 1 backups predate recurringSeries — default to empty array.
  if (version === 1) {
    data['recurringSeries'] = [];
  } else if (!Array.isArray(data['recurringSeries'])) {
    throw new Error('Backup is malformed: data.recurringSeries is not an array');
  }

  return {
    version,
    exportedAt: env['exportedAt'] as number,
    data: data as unknown as BackupData,
  };
}
