/**
 * Pure backup policy helpers. No React Native / Expo / DB imports — Node-testable.
 */
import { BackupData } from '../lib/backup';

/**
 * Settings keys that are backup bookkeeping, not user data — excluded from
 * every backup, both the legacy JSON path (`gatherBackupData`,
 * src/features/backup/repository.ts) and the `.sqlite` export path
 * (`exportPlaintextSnapshot`, src/features/backup/sqliteFile.ts), so
 * restoring a backup never re-seeds stale auto-backup state (which would
 * otherwise cause one spurious extra auto-backup). Defined once here so the
 * two call sites can't drift apart.
 */
export const BACKUP_BOOKKEEPING_SETTINGS_KEYS = ['backup_last_sig', 'backup_last_at'] as const;

/**
 * Per-device / security settings that must NOT travel in a data backup — a
 * restore must never carry a biometric-lock or per-device pref onto another
 * device/state (biometric_lock restored without the enable-gate's auth check
 * can lock a user out). Distinct from BACKUP_BOOKKEEPING_SETTINGS_KEYS
 * (internal state); both are excluded from backups, but device-local keys must
 * ALSO be skipped on restore because older backups still contain them.
 * `onboarding_complete` is here too: it's per-device UX state, not user data —
 * a restore onto a fresh device must not silently mark it "already onboarded"
 * (nor could an old backup ever wrongly suppress the tutorial on a genuinely
 * new device by carrying a stale value either way).
 */
export const DEVICE_LOCAL_SETTINGS_KEYS = [
  'biometric_lock',
  'backup_auto_enabled',
  'theme',
  'onboarding_complete',
] as const;

/**
 * Union of every settings key that must never appear in a backup file:
 * bookkeeping (internal state) plus device-local (security/per-device prefs).
 * Used to strip the snapshot on backup create (both the legacy JSON path and
 * the `.sqlite` export path).
 */
export const SETTINGS_EXCLUDED_FROM_BACKUP = [
  ...BACKUP_BOOKKEEPING_SETTINGS_KEYS,
  ...DEVICE_LOCAL_SETTINGS_KEYS,
] as const;

/**
 * Filters a settings map down to the keys safe to apply during a restore —
 * drops DEVICE_LOCAL_SETTINGS_KEYS so a backup (including an older one made
 * before this fix, which may still contain `biometric_lock='1'`) can never
 * overwrite the device's own biometric-lock/theme/auto-backup preference.
 * Genuine user data (`currency`, `avatar_look`, `avatar_kind`, etc.) passes
 * through unchanged.
 */
export function settingsForRestore(values: Record<string, string>): Record<string, string> {
  const result = { ...values };
  for (const key of DEVICE_LOCAL_SETTINGS_KEYS) {
    delete result[key];
  }
  return result;
}

/**
 * Filters a settings map down to the keys safe to include in a backup
 * snapshot — drops SETTINGS_EXCLUDED_FROM_BACKUP (bookkeeping + device-local)
 * so a new backup never contains stale bookkeeping or the device's
 * biometric-lock/theme/auto-backup preference. Used by `gatherBackupData`
 * (src/features/backup/repository.ts).
 */
export function settingsForBackup(values: Record<string, string>): Record<string, string> {
  const result = { ...values };
  for (const key of SETTINGS_EXCLUDED_FROM_BACKUP) {
    delete result[key];
  }
  return result;
}

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
