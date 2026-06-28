# Build spec: iCloud snapshot backup & restore (unencrypted, keep-last-3)

## Objective
Add automatic + manual backup of the full local dataset as timestamped JSON
snapshots in the app's iCloud Drive container, and one-tap restore from any
snapshot — retaining the last 3. Backups are **unencrypted** (we rely on Apple's
iCloud encryption; guardrail #5 is relaxed for backups, documented).

## Scope (in)
- **Serialization (pure TS):** refactor `src/lib/backup.ts` to a plaintext JSON
  envelope (no crypto), extended to include `recurringSeries`.
- **Restore-apply (feature):** transactional clear-and-reinsert of all data
  tables, **id-preserving**, plus post-restore recurring catch-up.
- **iCloud transport (native):** add `react-native-cloud-storage` + its Expo
  config plugin + iCloud entitlement, behind a thin adapter.
- **Orchestration (feature):** create/list/restore/prune backups; opportunistic
  auto-backup with change-detection + min-interval.
- **Retention:** keep last 3, prune older (pure, tested).
- **UI:** a `Backups` screen (toggle, Create backup, Recent list → restore)
  reached from Settings, replacing the placeholder Export/Restore alerts.
- **Security docs:** update `docs/SECURITY.md` + add ADR 0006; in-app
  "stored in your iCloud" note.

## Scope (out — do NOT build/touch)
- App-level encryption / iCloud Keychain / passphrases (guardrail #5 deferred).
- The iCloud **status** screen (NSMetadataQuery upload/download %, "Download from
  iCloud") — Phase 2, needs custom Swift.
- CloudKit, field-level merge/live sync, Android iCloud (adapter no-ops off-iOS).
- DB schema/migration changes; `parse_metrics` (test-only, excluded).

## Approach

**`src/lib/backup.ts` (pure, refactor — drop crypto):**
- Bump `BACKUP_VERSION` to `2`. `BackupData` gains `recurringSeries: RecurringSeries[]`.
- `serializeBackup(data, now): string` → JSON of `{ version, exportedAt, data }`.
- `parseBackup(json): BackupEnvelope` → JSON.parse + validate: reject
  `version > 2`; for `version 1` default `recurringSeries: []`; basic shape check;
  throw on malformed.
- Remove `exportBackup`/`restoreBackup`/the `CryptoProvider` import.
  **Delete `src/lib/crypto.ts`** (now unreferenced).

**`src/domain/backupPolicy.ts` (new, pure, Node-tested):**
- `selectBackupsToPrune(metas: {name,exportedAt}[], keep=3): string[]` — names to
  delete (oldest beyond `keep`).
- `backupSignature(data): string` — cheap content hash (counts per table + max
  createdAt) to detect "nothing changed".
- `shouldAutoBackup(sig, lastSig, now, lastAt, minIntervalMs): boolean` — true
  only if `sig !== lastSig` AND `now - lastAt >= minIntervalMs`.

**`src/features/backup/icloud.ts` (new, native adapter):**
- Wrap `react-native-cloud-storage`: `isAvailable()`, `write(name,contents)`,
  `list(): {name,size,exportedAt}[]`, `read(name)`, `remove(name)`. Files in the
  app's iCloud Documents container; names `projectxavier-backup-<exportedAt>.json`.
- `isAvailable()` false off-iOS / when iCloud unavailable.

**`src/features/backup/repository.ts` (new, app-only):**
- `gatherBackupData()` — `listAccounts/listCategories/listPayees/listTransactions/
  listSeries/getAllSettings` (omit `backup_last_*` keys from the settings snapshot).
- `applyBackup(data)` — **critical.** One transaction (`expoDb.withTransactionAsync`):
  DELETE accounts/categories/payees/transactions/recurring_series, then **raw
  id-preserving** Drizzle inserts for every row (domain→row mapping;
  `openingBalance`→`opening_balance`; series rule/template/skippedDates
  `JSON.stringify`). Then `applySettings(data.settings)`. After the transaction,
  `postDueOccurrences(Date.now())`. Do NOT use `createCategory`/`findOrCreatePayee`
  (they mint new ids).
- `createBackup()` — gather → serialize → `icloud.write` → prune via
  `selectBackupsToPrune`.
- `listBackups()`, `restoreFromName(name)` (read→`parseBackup`→`applyBackup`),
  `restoreLatest()`.
- `maybeAutoBackup()` — gated by `backup_auto_enabled` + `icloud.isAvailable()` +
  `shouldAutoBackup`; on success store `backup_last_sig`/`backup_last_at`.
  `MIN_AUTO_INTERVAL_MS = 3_600_000`; `KEEP = 3`.

**Auto-backup trigger:** an `AppState` listener (background/inactive) calling
`maybeAutoBackup()` — in `app/_layout.tsx` or a small hook. Opportunistic.

**`app/backups.tsx` (new screen):** description card; "Automatic Backup" toggle
(`backup_auto_enabled`, **default OFF**); "Create backup" (manual, busy+result);
"Recent Backups" list from `listBackups()` (relative time + size, newest first),
tap → confirm (destructive) → `restoreFromName` → success → pop back;
iCloud-unavailable state; footer "Backups are saved unencrypted to your iCloud."
Match existing screen styling.

**`app/(tabs)/settings.tsx`:** replace the two "Export encrypted backup" /
"Restore from backup" placeholder rows with one `Row label="Backups"
onPress={() => router.push('/backups')}`.

**Docs:** rewrite the SECURITY.md backup row (unencrypted in iCloud; at-rest =
iCloud + biometric lock; #5 deferred for backups). Add
`docs/adr/0006-icloud-unencrypted-backups.md` (supersedes the backup half of #5;
references ADR 0002).

**Dependency/native:** add `react-native-cloud-storage` + Expo config plugin to
`app.config.ts` with iCloud container `iCloud.com.projectxavier.app`. Requires an
EAS/dev-client rebuild (Expo Go won't run it).

## Requirements / acceptance criteria
- [ ] `serializeBackup`→`parseBackup` round-trips a dataset **including
  `recurringSeries`** with no loss (pure test).
- [ ] `parseBackup` rejects `version > 2`; accepts `version 1` (recurringSeries→[]);
  throws on malformed.
- [ ] `selectBackupsToPrune` keeps the 3 newest, returns the older names;
  `shouldAutoBackup` false when signature unchanged OR within the min-interval,
  true otherwise (pure tests).
- [ ] `applyBackup` reinserts **preserving every id**; restored transactions'
  category/payee references resolve; runs in a transaction so a mid-restore
  failure leaves prior data intact (no half-wiped DB).
- [ ] After restore, `postDueOccurrences` ran; screens show restored data on focus.
- [ ] Manual "Create backup" writes one `projectxavier-backup-<ts>.json` and prunes
  to ≤3.
- [ ] Auto-backup ON: a background event backs up only when changed AND ≥1h since
  last; OFF: never.
- [ ] iCloud unavailable / non-iOS: create/list/restore fail gracefully; auto-backup
  skips; no crash.
- [ ] Settings shows one "Backups" entry → `/backups`; old alerts gone.
- [ ] `crypto.ts` deleted; no dangling imports; `BACKUP_VERSION === 2`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green (existing + new pure
  tests). Native iCloud + `applyBackup` (DB) are NOT Node-testable — review +
  later device verification.
- [ ] SECURITY.md updated; ADR 0006 added.

## Constraints & conventions
- Pure logic (`backup.ts`, `backupPolicy.ts`) framework-free + Node-tested; native
  + DB in `src/features/backup/` and `app/`.
- DB writes via Drizzle/parameterised; restore inserts map to exact
  `src/db/schema.ts` columns.
- Reuse `getSetting`/`setSetting`/`applySettings` and existing UI patterns.
- `react-native-cloud-storage` calls confined to `src/features/backup/icloud.ts`.

## Edge cases & risks
- **Restore is destructive — atomicity is non-negotiable.** Clear+insert is one
  transaction; failure rolls back. Biggest risk.
- **Id preservation** — raw inserts only; `createCategory`/`findOrCreatePayee`
  would orphan references. QA verifies referential integrity post-restore.
- **iCloud file not downloaded** (evicted on a 2nd device) — `read()` triggers/awaits
  download; clear error if it can't. (Status UI is Phase 2.)
- **Version skew** — refuse newer-version backups; never partially apply.
- **Keep-3 vs frequency** — change-detection + 1h interval stop rapid snapshots
  evicting older meaningful ones; manual bypasses the interval.
- **Bookkeeping keys** — exclude `backup_last_*` from the snapshot.
- **Native unverifiable in CI** (Actions over budget + no device) — local checks
  are the bar; iCloud round-trip is a device-time check.

## Suggested handoff
> Use the implementer agent to build the spec above (pure `backup.ts`/
> `backupPolicy.ts` + tests first, then `applyBackup`, the iCloud adapter +
> config, orchestration, the `Backups` screen + Settings entry, then SECURITY.md
> + ADR 0006). Then run qa-tester on the diff (focus: serialize/parse +
> recurringSeries round-trip, prune/auto-gate logic, and a close read of
> `applyBackup` for id-preservation + transactional atomicity). Then reviewer. Do
> not push (Actions over budget) — local green is the bar.
