# Spec: switch backups to plaintext SQLite format (assessment M3)

Source: assessment M3. Two problems bundled: (1) the fake v1 "AES-encrypted"
restore path is fiction — `parseBackup` has no decryption, its round-trip test
feeds a plaintext v1 payload that never existed; (2) current v2 backups are
plaintext JSON assembled by `gatherBackupData`, which can silently miss a
column added to the schema.

Decision (with the user): move new backups to a **plaintext SQLite file**,
chosen for **exactness** — a whole-DB image can't miss a column. Backups stay
plaintext (portable restore, no key needed), so M3's confidentiality half is
consciously **accepted and disclosed**, not fixed (encrypting the backup was
rejected: it would make restore device-bound, wrong for a personal app). The
live DB stays SQLCipher-encrypted (H4) — independent of this.

## Objective

- New backups are complete-by-construction plaintext SQLite files.
- Restore round-trips exactly, and still restores the user's existing `.json`
  backups (nothing orphaned).
- The v1-encrypted fiction and its lying test are removed; docs/privacy copy
  made honest about plaintext backups.

## Approach

### Backup create (`src/features/backup/` — replaces JSON serialize)

The live DB is SQLCipher-keyed. Produce a **plaintext** SQLite snapshot via
SQLCipher's export-with-empty-key, on the keyed connection (`expoDb.execAsync`):
```
ATTACH DATABASE '<tmpdir>/projectxavier-backup.sqlite' AS plain KEY '';
SELECT sqlcipher_export('plain');
DETACH DATABASE plain;
```
`KEY ''` = no encryption on the attached DB, so the output file is a plain
SQLite database containing all 6 tables — guaranteed complete (no
`gatherBackupData` enumeration to drift). Then upload as binary:
`icloud.uploadFile('projectxavier-backup-<ts>.sqlite', <tmp path>, { mimeType:
'application/x-sqlite3' })` (react-native-cloud-storage `uploadFile` takes a
local path — confirmed). Keep the `KEEP=3` prune. Delete the tmp file after.
Backup create is non-destructive (writes a new remote file, prunes old) — a
partial/interrupted create just leaves a stray file the next prune removes.

New filename suffix `.sqlite`; keep the `projectxavier-backup-<ts>` prefix so
`parseExportedAt` still sorts by timestamp. `icloud.buildName`/`list` updated to
recognise BOTH `.sqlite` (new) and `.json` (legacy) so the backups screen shows
all of them.

### Restore (`applyBackup` reused — the data-integrity-critical path)

**Revision (QA fix, post-implementation):** the first cut of this spec had
restore copy tables with raw `INSERT INTO <table> SELECT * FROM src.<table>`.
QA reproduced two defects that come from that being a *positional*,
untyped copy: (Blocker) SQLite has no strict column typing, so a `.sqlite`
file hand-edited to contain `amount = 'NOT_A_NUMBER'` (or any other
malformed value) inserted and **committed with no error**, corrupting every
downstream money calculation; (Major) a backup taken on an older schema (with
fewer columns) failed outright — `table transactions has N columns but M
values were supplied` — because a positional copy requires identical column
*order and count* on both sides. The design below is the fix; the raw-copy
description above no longer applies.

Route by suffix in `restoreFromName`:
- **`.sqlite` (new):** `icloud.downloadFile(remote, <cache>/projectxavier-restore-<token>.sqlite)`
  to a **per-call unique scratch path** (`<token>` from `newId()`, not a fixed
  name — two restores kicked off close together must not race on the same
  download destination, since `downloadFile` throws if its destination
  already exists). Then, **inside the existing H1 `runExclusive` mutex**:
  1. `ATTACH '<tmp>' AS src KEY '';` on the keyed live connection.
  2. Check `src.sqlite_master` contains all 6 expected tables
     (`missingTables`) — reject an obviously foreign/corrupt file before
     reading anything.
  3. `SELECT * FROM src.<table>` for each of the 6 tables, and **map +
     validate every row in JS**: snake_case SQL columns and 0/1
     integer-booleans are converted to the camelCase domain shape (mirroring,
     not importing, the existing `rowToX` mappers — importing them would drag
     `expo-sqlite` into the pure domain layer), then parsed through the
     EXISTING zod schemas (`accountSchema`, `categorySchema`, `payeeSchema`,
     `transactionSchema`, `recurringSeriesSchema`, plus a small new
     `settingsRowSchema`). **Any row failing validation throws immediately —
     before any live table is touched.** (`src/domain/sqliteBackupRows.ts`,
     Node-tested.)
  4. `DETACH src` (this function only reads; nothing has been written yet).
  5. Hand the validated `BackupData` to the EXISTING `applyBackupUnlocked` —
     the exact same wipe-and-reinsert-by-named-column function the `.json`
     path already uses via `applyBackup`. Named-column inserts (not
     positional) are what let a backup from an older schema (missing e.g.
     `pending`/`seriesId`/`occurrenceDate`) restore fine onto the migrated
     live schema — the missing fields get the same zod
     `.optional()`/`.default(...)` fallback a fresh row would get, and the
     insert doesn't care that the source had fewer columns.
  Delete the scratch file after (`finally`).
- **`.json` (legacy):** unchanged path — `icloud.read` (string) → `parseBackup`
  → `applyBackup(data)`. So existing backups still restore.

Both funnel into the same wipe-and-reinsert-in-a-transaction under the H1 mutex
(`applyBackupUnlocked`), so restore's crash-safety/rollback profile is
UNCHANGED from today (transaction rolls back on failure; mutex serialises
against auto-backup — H1). No new data-loss window is introduced on the
destructive half, and now — unlike the raw-copy first cut — nothing is wiped
at all unless every row in the backup file already validated successfully.

One real SQLite mechanics note verified against SQLite 3.51 with the local
CLI: ATTACH may run before a `BEGIN`, but DETACHing an attached database
*while still inside* an open write transaction against it fails ("database is
locked"). This restore path only ever reads from `src` (never inside a
transaction), so it doesn't hit this; `applyBackupUnlocked`'s own transaction
runs afterwards, entirely on the (by-then-detached) live connection.

### Honesty pass (`src/lib/backup.ts` + docs)

- Delete the v1-"encrypted" claim from the version history and any dead
  decryption-shaped branch; remove the fictional plaintext-v1 round-trip test.
  If confirmed no real v1 files can exist (no public users; KEEP=3 rotated them
  out), drop v1 handling entirely rather than adding a legacy error path.
- Bump the format note: v3 = plaintext SQLite file; v2 = legacy plaintext JSON
  (restore-only). `serializeBackup`/`parseBackup` (JSON) stay ONLY for reading
  legacy `.json` files.
- Update `docs/adr/0006-icloud-unencrypted-backups.md` and confirm the App
  Privacy answers state backups are plaintext SQLite files in the user's own
  iCloud (DB is encrypted at rest; backups are not).

## Acceptance criteria

Native (SQLCipher export/import, binary iCloud I/O) can't be Node-tested, so:
1. **Node suite green** (`npm run typecheck && npm run lint && npm test`, 431+).
   Pure/testable pieces get unit tests: filename build/parse for `.sqlite` AND
   `.json`, suffix→restore-route selection, prune selection across mixed
   suffixes, and the row mapping/validation logic
   (`src/domain/sqliteBackupRows.ts`, `backup-sqlite-rows.feature`) — including
   a cross-schema (fewer-columns) row succeeding with defaults filled in, and
   a malformed/malicious row (non-numeric `amount`, invalid `type`) being
   rejected before any `BackupData` is produced.
2. **Sim smoke test** of the REAL create+restore (like H4's): create a backup
   from a seeded DB → confirm the produced file is a valid PLAINTEXT SQLite
   (hexdump header `SQLite format 3\0`, opens without a key) and contains all
   rows → wipe the live DB → restore from it → assert every row returns exactly.
   Also: restore a legacy `.json` backup and confirm it still works. And a
   real binary upload→download round-trip through react-native-cloud-storage
   (this is the one genuinely new external dependency — prove it moves bytes
   intact, not just that the methods exist).
3. **Device confirm** (build 32): back up → delete data / reinstall → restore →
   all data returns; a pre-existing `.json` backup still restores.

## Constraints

- Guardrail #1 (backup/restore must round-trip) is the whole point — the sim
  smoke MUST demonstrate an exact round-trip before this ships.
- Backup is plaintext by design; the produced `.sqlite` MUST NOT be encrypted
  (verify header is `SQLite format 3\0`, not random) — i.e. use `KEY ''`, and do
  NOT accidentally copy the encrypted live file.
- Restore reuses the H1 mutex + transaction; do not add a second file-swap
  migration (that's H4's machinery; not needed here — we copy rows, we don't
  replace the live DB file).
- `src/domain/**` stays framework-free; SQLCipher/cloud glue lives in
  `src/features/backup/`.
- Guardrail #6 (validate every trust boundary with zod): a `.sqlite` restore
  file is user-editable (visible in the Files app) and MUST be validated
  row-by-row through the existing schemas before anything is wiped — no raw
  `INSERT ... SELECT *` copy, which has no way to reject a malformed value.

## Edge cases

- **Mixed backup list** (old `.json` + new `.sqlite` in iCloud): list shows
  both, sorted by timestamp; prune keeps the newest 3 regardless of suffix;
  restore routes by suffix.
- **Interrupted create:** stray tmp/remote file; harmless, pruned later.
- **Corrupt/foreign `.sqlite`:** either `missingTables` rejects it up front (a
  required table is absent from `sqlite_master`), or a present-but-malformed
  row fails zod validation — both happen entirely before any live table is
  touched, so there is nothing to roll back: live data is simply never wiped.
  A clear, table-and-row-scoped error is surfaced either way.
- **Malicious/hand-edited `.sqlite`** (assessment guardrail #6 — a `.sqlite`
  in the user's iCloud Files app is a user-editable trust boundary): a row
  with a non-numeric `amount`, an out-of-range `type`, etc. is rejected by the
  same zod schemas every other write path already uses — it is never inserted
  even transiently.
- **`parse_metrics` (diagnostics table):** deliberately dropped from the
  exported `.sqlite` snapshot (`DELETE FROM plain.parse_metrics;` right after
  `sqlcipher_export`, before upload) — it was already "deliberately excluded
  from backups" for the legacy JSON format (see `src/db/schema.ts`), and
  restore only ever reads the 6 domain tables regardless, so leaving it in
  the export served no purpose and made restore's effect on it inconsistent
  with every other table (never wiped/replaced either way). Excluding it at
  export time keeps the backup file lean and the exclusion intentional and
  documented, rather than an accident of what `sqlcipher_export` happens to
  copy.
- **Empty DB backup:** produces a valid empty-schema SQLite file; restore of it
  yields an empty dataset (same as today's empty JSON).
- **Large `sourceText`:** already capped at 2000 (H2); no backup-size concern.
- **Cross-schema restore** (a backup taken on an older schema, missing
  columns the live schema has since added): the missing keys are simply
  absent after the raw→camelCase conversion; the same zod
  `.optional()`/`.default(...)` that a fresh row would get supplies the
  default, and the named-column insert doesn't require the source to have had
  those columns at all. Node-tested in `backup-sqlite-rows.feature`.
