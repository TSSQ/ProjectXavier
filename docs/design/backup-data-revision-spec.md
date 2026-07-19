# Spec: backup data revision (review F3 / M4 — edits never trigger auto-backup)

Fixes the confirmed critical the store doc already tracks as **M4
(edit-triggers-backup)**: `backupSignature` is row counts + max transaction
`createdAt` + a settings fold (`src/domain/backupPolicy.ts:95-119`). Editing an
existing row preserves its `createdAt` (`app/(tabs)/transactions.tsx` edit path
reuses the stashed original), so amount/date/account/category/payee/note/pending
corrections leave the signature unchanged and `shouldAutoBackup` declines. The
backups screen promises "only when data has changed" — with the current
definition of "changed", most edits don't count. On an app where a lost
SQLCipher key makes the iCloud backup the *only* recovery path, a backup that
silently excludes corrections is a release blocker, not a fast-follow.

Fix: an application-managed monotonic **`data_revision`** in the settings KV
table, bumped by every financial mutation, folded into the signature. No schema
migration (settings is generic key/value), no change to `shouldAutoBackup` or
the upload/prune flow. No product forks; behaviour-invisible except that
backups now actually happen after edits.

## Scope

**IN:**
1. **`bumpDataRevision()`** in `src/features/settings/repository.ts` — one
   parameterised upsert incrementing the `data_revision` settings row
   (absent → writes `1`). Reader `getDataRevision(): Promise<number>` (absent
   → 0).
2. **Bump at every financial chokepoint** — the same repository layer where
   `updateWidgetSummary()` already hooks:
   - transactions: `createTransaction`, `updateTransaction`, `deleteTransaction`
   - accounts: create / update / archive
   - categories: create / update / delete
   - payees: create / update / delete
   - recurring: create / update / pause / skip / archive, `postDueOccurrences`
     (once per batch that inserted ≥1 row), `splitAndContinue`
   - restore: once at the end of the restore path (it writes via raw
     `db.delete`/`insert`, bypassing the repositories)
   AI saves and both manual screens funnel through `createTransaction`, so they
   are covered by construction.
3. **Signature v2** — `backupSignature` becomes
   `` `v2:${dataRevision}:${settingsSig}` `` (settings fold unchanged,
   still excluding `backup_last_*` and device-local keys). Row counts and
   `maxCreatedAt` drop out — the revision strictly dominates them (every
   insert/delete also bumps). `BackupData` gathering passes the revision in.
4. **Device-local revision** — add `data_revision` to
   `DEVICE_LOCAL_SETTINGS_KEYS` (`src/features/settings/repository.ts`): it is
   a device-lifetime counter, not ledger content — excluded from the snapshot
   and from restore-apply, exactly like `biometric_lock`. Signatures are only
   ever compared locally.
5. **Backups screen copy** — none needed: "only when data has changed" becomes
   true. Verify the string, adjust only if it names the old mechanism.

**OUT:**
- Wrapping mutation + bump in one SQLite transaction — blocked on the
  recurring-atomicity work (review F5) introducing `db.transaction` usage; the
  ordering below makes the interim window harmless.
- Content hashing — needless: the app owns every write path.
- Backup format/envelope changes, retention, pre-restore snapshot (review F6)
  — separate spec.

## Approach (concrete)

### Bump ordering and failure mode
Bump **after** the successful write, in the same async function, awaited:
```ts
export async function updateTransaction(input: Transaction): Promise<void> {
  const tx = transactionSchema.parse(input);
  await db.update(transactions).set({ /* … */ }).where(eq(transactions.id, tx.id));
  await bumpDataRevision();
  void updateWidgetSummary();
}
```
If the bump itself fails, the next successful mutation bumps anyway — a missed
backup *signal* self-heals; the reverse ordering could signal a backup for a
write that never landed. `maybeAutoBackup` runs on app-backgrounding
(`app/_layout.tsx:79-85`), so the bump is never on a user-visible hot path
except alongside the write it follows.

### `src/domain/backupPolicy.ts`
`backupSignature(data)` reads `data.dataRevision: number` (new `BackupData`
field, gathered via `getDataRevision()`), returns
`` `v2:${data.dataRevision}:${settingsSig}` ``. `shouldAutoBackup` unchanged.
The stored `backup_last_sig` (`src/features/backup/repository.ts:343-353`)
keeps working: on first launch after this ship the stored v1 string can never
equal a v2 string → exactly one catch-up auto-backup on next backgrounding,
which is the desired behaviour for existing installs.

### `postDueOccurrences`
Bump once after the loop if it inserted at least one occurrence — not per row —
so a 30-day catch-up is one revision step (signature only needs *different*,
not *counted*).

## Acceptance criteria
1. **Node suite green** — typecheck, lint, `npm test`. New BDD scenarios
   (pure domain + settings-shape level):
   - v2 signature changes when only `dataRevision` changes; stable when nothing
     changes; changes when a non-excluded setting changes
   - v2 signature ≠ any v1-format string (catch-up backup guaranteed)
   - `shouldAutoBackup` still respects the min-interval clamp with v2 strings
2. **Bump coverage (read-verified + sim)** — every mutating repository export
   listed in Scope-2 calls `bumpDataRevision()`; verified by grep in review and
   by the sim flow below. (The repositories depend on expo-sqlite and are
   intentionally outside the Node suite.)
3. **Sim/device confirm** — edit an existing transaction's amount → background
   the app → Backups screen shows a new backup; background again with no
   changes → no new backup; toggle pending on an old row → new backup.
4. **Restore** — restoring an older backup then backgrounding produces a new
   backup of the restored state (restore bumps; `backup_last_sig` predates it).

## Edge cases
- **Two devices, one iCloud pool** — revisions are device-local and never
  synced, so device A's counter can't collide with B's; each device compares
  only its own `backup_last_sig`. (The shared 3-slot retention pool pruning
  another device's backups is review F6, out of scope here.)
- **Settings-only changes** (currency, avatar, theme) — still trigger via the
  settings fold, as today; device-local keys still excluded, so toggling Face
  ID still doesn't force a backup.
- **Revision overflow** — integer stored as string; JS safe-integer range makes
  overflow unreachable in practice (one bump per user mutation).
- **Failed upload** — unchanged semantics: `backup_last_sig` is only written
  after a successful upload, so the next backgrounding retries.
