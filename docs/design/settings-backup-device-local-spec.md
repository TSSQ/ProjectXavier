# Spec: don't back up / restore device-local settings (Face ID lock bug)

Bug found on build 33 device test: Face ID was disabled on launch but Settings
showed it enabled. Root cause: `biometric_lock` is included in backed-up
settings, so restoring a backup wrote `biometric_lock='1'` into the DB —
which (a) mismatched the launch gate (already run pre-restore) and, worse,
(b) **silently enabled the biometric lock with no auth, bypassing the enable-gate**
(`authenticateToEnableLock`) that build 33 added. A restored lock on a device
where biometrics don't work is a potential lockout. Device-local/security
settings must not travel in a data backup.

Decided with the user: **device-local only** — exclude `biometric_lock`,
`backup_auto_enabled`, and `theme` from backup AND restore; keep genuine user
data (`currency`, `avatar_look`, `avatar_kind`) so real choices still restore.
Bug fix with an obvious shape → spec auto-passes.

## Scope
- IN: `biometric_lock`, `backup_auto_enabled`, `theme` excluded from backup
  create AND restore-apply.
- KEEP backed up: `currency`, `avatar_look`, `avatar_kind`.
- OUT: any UI/settings-screen change; the Face ID logic itself (build 33) is
  unchanged and correct.

## Approach

### 1. `src/domain/backupPolicy.ts`
Add a device-local exclusion list next to the existing bookkeeping one:
```ts
/** Per-device / security settings that must NOT travel in a data backup — a
 *  restore must never carry a biometric-lock or per-device pref onto another
 *  device/state (biometric_lock restored without the enable-gate's auth check
 *  can lock a user out). Distinct from BACKUP_BOOKKEEPING_SETTINGS_KEYS
 *  (internal state); both are excluded from backups, but device-local keys must
 *  ALSO be skipped on restore because older backups still contain them. */
export const DEVICE_LOCAL_SETTINGS_KEYS = ['biometric_lock', 'backup_auto_enabled', 'theme'] as const;
```
(Optionally export a combined `SETTINGS_EXCLUDED_FROM_BACKUP = [...BACKUP_BOOKKEEPING_SETTINGS_KEYS, ...DEVICE_LOCAL_SETTINGS_KEYS]` for the gather/export strip.)

### 2. Backup create — strip on gather + on sqlite export
- `gatherBackupData` (`src/features/backup/repository.ts:73`): the loop that
  deletes `BACKUP_BOOKKEEPING_SETTINGS_KEYS` from the settings snapshot must
  ALSO delete `DEVICE_LOCAL_SETTINGS_KEYS` (use the combined list). New backups
  then contain none of them.
- `exportPlaintextSnapshot` (`src/features/backup/sqliteFile.ts`): the
  `DELETE FROM plain.settings WHERE key IN (...)` already built from
  `BACKUP_BOOKKEEPING_SETTINGS_KEYS` must include the device-local keys too
  (use the combined list). So the plaintext `.sqlite` backup file also omits
  them.

### 3. Restore — skip on apply (THE essential part for old backups)
Older backups already contain `biometric_lock` (and maybe `theme`/`backup_auto_enabled`).
Stripping on create doesn't protect a restore of those. So the restore's
settings-apply MUST skip device-local keys:
- `applySettings` (`src/features/settings/repository.ts:~130`) is used only by
  backup restore (both the JSON `applyBackup` path and the sqlite
  `applyBackupUnlocked` path funnel through it). Filter out
  `DEVICE_LOCAL_SETTINGS_KEYS` before upserting each key, so a restored map can
  never write `biometric_lock`/`theme`/`backup_auto_enabled`. (Bookkeeping keys
  are already absent from files, so they don't need skip-on-apply, but skipping
  the full combined set here is harmless and future-proof.)
- Verify BOTH restore paths go through `applySettings` (grep confirms
  `applyBackupUnlocked` → `applySettings(data.settings)`); if the sqlite
  row-reader (`sqliteBackupRows.ts`) builds the settings map, confirm it still
  routes through `applySettings` and not a direct upsert.

The device keeps its own `biometric_lock` (and theme/auto-backup) across any
restore. This closes the reported mismatch AND the enable-gate-bypass hole.

## Acceptance criteria
1. **Node suite green** (`npm run typecheck && npm run lint && npm test`).
   Unit-test the pure decision: the exclusion lists contain the right keys;
   a filter helper over a settings map removes `biometric_lock`/`theme`/
   `backup_auto_enabled` but keeps `currency`/`avatar_look`/`avatar_kind`
   (both the gather-strip direction and the apply-skip direction).
2. **Behavioural:** a backup created now contains `currency`/avatar but NOT the
   device-local keys; restoring a backup that DOES contain `biometric_lock='1'`
   does NOT change the device's `biometric_lock` (it keeps whatever the device
   had). Cover with tests at whatever layer is pure (the filter over a map).
3. **Device confirm (folded into the next build):** back up on the device,
   toggle the Face ID lock to a known state, restore — the lock state does NOT
   flip from the restore, and Settings matches the launch behaviour. Currency /
   avatar still restore.

## Constraints
- `src/domain/**` stays framework-free (the exclusion lists + any filter helper
  are pure and Node-tested).
- Do NOT touch the Face ID logic (build 33) or the responsive-scaling changes
  that are parked uncommitted in the worktree (entirely different files —
  `app/(tabs)/index.tsx`, `src/theme/*`, `src/domain/scaleMath.ts`; leave them).
- Only stage this fix's own files when it commits.

## Edge cases
- **Old backup containing biometric_lock='1':** restore skips it → device
  unchanged. (The primary scenario.)
- **Backup made on a device with the lock ON, restored on a device with no
  biometrics:** the lock is NOT enabled by the restore → no lockout.
- **currency/avatar:** still round-trip through backup/restore unchanged.
- **theme:** a restored backup won't change the device's theme; a fresh device
  keeps its own (system default) — acceptable (theme is a per-device UI pref).
