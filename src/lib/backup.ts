/**
 * Encrypted backup / restore.
 *
 * A backup is the full local dataset serialised to JSON, then encrypted with an
 * injected CryptoProvider. Restore reverses it. Because encryption happens
 * here (on-device), backups can be safely stored in iCloud/Files or synced to
 * the server as opaque blobs.
 */
import { Account, Category, Payee, Transaction } from '../domain/types';
import { CryptoProvider, EncryptedBlob } from './crypto';

export const BACKUP_VERSION = 1 as const;

export interface BackupData {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  transactions: Transaction[];
  /** App-level preferences (e.g. { currency: "SGD" }). Optional for backward
   *  compatibility with v1 backups that predate the settings store. */
  settings?: Record<string, string>;
}

export interface BackupEnvelope {
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  data: BackupData;
}

/** Serialise + encrypt a dataset into an opaque blob. */
export async function exportBackup(
  data: BackupData,
  passphrase: string,
  crypto: CryptoProvider,
  now: number = Date.now()
): Promise<EncryptedBlob> {
  const envelope: BackupEnvelope = {
    version: BACKUP_VERSION,
    exportedAt: now,
    data,
  };
  const salt = crypto.randomBytes(16);
  const key = await crypto.deriveKey(passphrase, salt);
  return crypto.encrypt(JSON.stringify(envelope), key, salt);
}

/** Decrypt + parse a blob back into a dataset. Throws on wrong passphrase. */
export async function restoreBackup(
  blob: EncryptedBlob,
  passphrase: string,
  crypto: CryptoProvider
): Promise<BackupEnvelope> {
  const salt = base64ToBytes(blob.salt);
  const key = await crypto.deriveKey(passphrase, salt);
  const plaintext = await crypto.decrypt(blob, key);
  const envelope = JSON.parse(plaintext) as BackupEnvelope;
  if (envelope.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${envelope.version}`);
  }
  return envelope;
}

function base64ToBytes(b64: string): Uint8Array {
  // Works in both Node and React Native (Buffer is polyfilled by Metro).
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
