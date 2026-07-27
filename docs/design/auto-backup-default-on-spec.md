# Spec: auto-backup enabled by default

## Objective
Make automatic iCloud backup **on by default** (opt-out, not opt-in). This is a
local-first app where a lost SQLCipher key makes the user's own iCloud backup
the ONLY recovery path — leaving the safety net off by default means a typical
user never gets a backup until they discover and flip a toggle. Combined with F3
(edits now bump `data_revision` so corrections actually back up), default-on
closes the "my data was only ever on the one device I lost" gap.

## Product decision (made by the user — no fork)
Auto-backup defaults ON. Backups go to the user's OWN iCloud container (not a
developer server) — "Data Not Collected" still holds; this is the user's private
backup of their own data, the same posture iOS itself uses.

## Current behaviour
`backup_auto_enabled` (a device-local settings key, already in
`DEVICE_LOCAL_SETTINGS_KEYS` / excluded from backup+restore) gates auto-backup.
Every read requires `=== '1'`, so an UNSET value = disabled:
- `maybeAutoBackup` (`src/features/backup/repository.ts:349-350`):
  `if (autoEnabled !== '1') return;`
- The Backups screen toggle (`app/backups.tsx:78,82`):
  `setAutoEnabled(setting === '1')` (two load sites).
The setter (`onToggleAuto`, `app/backups.tsx:91`) already writes an explicit
`'1'`/`'0'`.

## Approach — flip the read semantics to "on unless explicitly off"
Change the interpretation of the stored value from *"on iff `'1'`"* to
*"on unless `'0'`"*, so an UNSET value reads as enabled. The explicit setter is
unchanged, so once a user toggles, their choice is honoured verbatim; only the
never-touched default flips from off to on.

Concretely:
1. `src/features/backup/repository.ts` `maybeAutoBackup`: gate on
   `if (autoEnabled === '0') return;` (proceed when unset or `'1'`). Update the
   doc comment (`:333`) that says "enabled (=== '1')".
2. `app/backups.tsx` both load sites: `setAutoEnabled(setting !== '0')`.
3. Factor the default into ONE pure helper so the two layers can't drift — e.g.
   `resolveAutoBackupEnabled(value: string | null): boolean` (returns
   `value !== '0'`) in a domain module (mirrors `resolveBiometricLock`/
   `resolveOnboardingComplete` in the codebase), and use it in both the
   repository read and the screen. Node-testable.

No first-run write, no migration, no change to `shouldAutoBackup`, the signature,
the min-interval clamp, iCloud-availability checks, or the backup file
format/round-trip.

## Acceptance criteria
1. `resolveAutoBackupEnabled(null)` → true; `resolveAutoBackupEnabled('1')` →
   true; `resolveAutoBackupEnabled('0')` → false (pure, Node-tested).
2. `maybeAutoBackup` proceeds when `backup_auto_enabled` is unset (given the app
   is otherwise eligible: iCloud available, signature changed, interval elapsed)
   and short-circuits only when it's explicitly `'0'`.
3. The Backups screen toggle renders ON when the setting is unset, ON for `'1'`,
   OFF for `'0'`; toggling still persists an explicit `'1'`/`'0'` and a persisted
   `'0'` survives relaunch (stays off).
4. `backup_auto_enabled` remains device-local (excluded from backup+restore) —
   unchanged; a restore never flips another device's preference.
5. `npm run typecheck && npm run lint && npm test` green; existing
   backup-policy/backups tests updated for the new default; add scenarios for
   the three resolve cases + the maybeAutoBackup unset-proceeds path (via its
   existing test seam). No regression to F3's signature/data_revision behaviour
   or the backup round-trip (guardrail #1).

## Constraints
- Guardrail #1 (backup/restore round-trip) — this only changes the *enable* gate,
  not backup content or the round-trip.
- Keep the on/off interpretation in ONE pure helper used by both the repository
  and the screen, so they can never disagree.

## Edge cases
- A user who explicitly turned auto-backup OFF (`'0'`) stays OFF — the default
  flip must not override an explicit choice.
- Existing installs with an unset value become enabled on next launch (desired —
  the whole point is to protect everyone). Pre-launch, "existing installs" are
  only dev/test devices, so no surprise to real users.
- First eligible background after this ships (unset user, data present, signature
  changed) produces the first auto-backup — the intended safety-net behaviour.
