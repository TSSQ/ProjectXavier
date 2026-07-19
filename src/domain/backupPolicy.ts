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
 *
 * `selftransfer_scan_ack` (review F2) is the same shape of per-device UX
 * state as `onboarding_complete`: it just remembers that THIS device's user
 * has already been shown the one-time self-transfer scan alert. A restore
 * onto a fresh device must not silently carry that acknowledgement over and
 * suppress the alert there, even though the restored data may still contain
 * the very self-transfer rows the alert is meant to surface.
 *
 * `data_revision` (review F3) is a device-lifetime monotonic counter bumped
 * by every financial mutation (`bumpDataRevision`,
 * src/features/settings/repository.ts) and folded into `backupSignature`
 * below. It is bookkeeping about THIS device's write history, not ledger
 * content, and syncing/restoring it would be actively wrong: a restored
 * counter could collide with (or lag behind) the receiving device's own
 * count, corrupting its "has anything changed since the last backup" check.
 */
export const DEVICE_LOCAL_SETTINGS_KEYS = [
  'biometric_lock',
  'backup_auto_enabled',
  'theme',
  'onboarding_complete',
  'selftransfer_scan_ack',
  'data_revision',
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
 * Computes a cheap deterministic signature for a dataset: the app-managed
 * `dataRevision` counter (`bumpDataRevision`,
 * src/features/settings/repository.ts) plus a fold of the settings map (so
 * changes to currency/avatar/etc. also count as "changed"). Not a
 * cryptographic hash — just a fast change detector. (The caller excludes the
 * `backup_last_*` bookkeeping keys, so writing them after a backup doesn't
 * perturb the signature.)
 *
 * v2 (review F3 / M4): previously this folded per-table row counts + the
 * latest transaction `createdAt`, which never changed when an existing row
 * was edited in place (an edit reuses its original `createdAt`), so most
 * corrections silently never triggered an auto-backup. `dataRevision` is
 * bumped by every financial mutation — insert, update, AND delete — so it
 * strictly dominates the old signal and catches edits too. The `v2:` prefix
 * guarantees a v2 signature can never equal any v1-format string (which was
 * always `count:count:count:count:count:createdAt:settingsSig`, never
 * `v2:...`), so the very first backgrounding after this ships produces
 * exactly one catch-up auto-backup on every existing install, even if the
 * dataset itself hasn't changed since the last v1 backup.
 */
export function backupSignature(data: BackupData): string {
  const settings = data.settings ?? {};
  const settingsSig = Object.keys(settings)
    .sort()
    .map((k) => `${k}=${settings[k]}`)
    .join(',');

  return `v2:${data.dataRevision ?? 0}:${settingsSig}`;
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

/**
 * Pure resolution of the `backup_auto_enabled` setting's stored string value
 * into a boolean. No React Native / Expo / DB imports — Node-testable.
 * Mirrors `resolveBiometricLock` (src/domain/biometricLock.ts) but flipped:
 * this key is opt-OUT, not opt-in. A lost SQLCipher key makes the user's own
 * iCloud backup the only recovery path, so an unset value (`null`, no row
 * written yet — the common case for both fresh installs and every existing
 * install before this shipped) resolves to `true`: auto-backup runs unless
 * the user explicitly turned it off. Once a user has ever toggled it, `'1'`
 * stays on and `'0'` stays off, verbatim — the default flip only changes the
 * never-touched case. Used by both `maybeAutoBackup`
 * (src/features/backup/repository.ts) and the Backups screen
 * (app/backups.tsx) so the two layers can't drift apart.
 */
export function resolveAutoBackupEnabled(value: string | null | undefined): boolean {
  return value !== '0';
}
