/**
 * Pure backup policy helpers. No React Native / Expo / DB imports — Node-testable.
 */
import { BackupData } from '../lib/backup';

/**
 * Returns the names of backup files that should be pruned, keeping the
 * `keep` newest by `exportedAt`.
 *
 * @param metas  Metadata for each backup file.
 * @param keep   How many to keep (default 3).
 * @returns      Names of the files to delete (oldest beyond the keep window).
 */
export function selectBackupsToPrune(
  metas: { name: string; exportedAt: number }[],
  keep: number = 3,
): string[] {
  const sorted = [...metas].sort((a, b) => b.exportedAt - a.exportedAt);
  return sorted.slice(keep).map((m) => m.name);
}

/**
 * Computes a cheap deterministic signature for a dataset: per-table row counts,
 * the latest transaction `createdAt`, and a fold of the settings map (so changes
 * to currency/avatar/etc. also count as "changed"). Not a cryptographic hash —
 * just a fast change detector. (The caller excludes the `backup_last_*`
 * bookkeeping keys, so writing them after a backup doesn't perturb the signature.)
 */
export function backupSignature(data: BackupData): string {
  // reduce (not Math.max(...spread)) to stay safe on very large arrays.
  const maxCreatedAt = data.transactions.reduce(
    (m, t) => (t.createdAt > m ? t.createdAt : m),
    0,
  );
  const settings = data.settings ?? {};
  const settingsSig = Object.keys(settings)
    .sort()
    .map((k) => `${k}=${settings[k]}`)
    .join(',');

  return [
    data.accounts.length,
    data.categories.length,
    data.payees.length,
    data.transactions.length,
    data.recurringSeries.length,
    maxCreatedAt,
    settingsSig,
  ].join(':');
}

/**
 * Returns true iff an auto-backup should be triggered.
 *
 * Conditions (both must hold):
 *  1. The dataset has changed since the last backup (`sig !== lastSig`).
 *  2. At least `minIntervalMs` has elapsed since the last backup.
 *
 * @param sig           Current dataset signature.
 * @param lastSig       Signature from the most recent backup, or null if none.
 * @param now           Current time (ms since epoch).
 * @param lastAt        Time of the most recent backup (ms since epoch). 0 if none.
 * @param minIntervalMs Minimum time between auto-backups.
 */
export function shouldAutoBackup(
  sig: string,
  lastSig: string | null,
  now: number,
  lastAt: number,
  minIntervalMs: number,
): boolean {
  if (sig === lastSig) return false;
  if (now - lastAt < minIntervalMs) return false;
  return true;
}
