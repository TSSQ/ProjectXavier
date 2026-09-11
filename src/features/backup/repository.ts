/**
 * Backup orchestration: gather, create, list, restore, and auto-backup.
 *
 * This module ties together:
 *  - src/lib/backup.ts  (pure serialisation — legacy `.json` restore only,
 *    assessment M3)
 *  - src/features/backup/sqliteFile.ts  (SQLCipher plaintext-snapshot glue —
 *    new `.sqlite` backups, assessment M3)
 *  - src/domain/backupFilename.ts  (pure filename build/parse/route)
 *  - src/domain/backupPolicy.ts  (pure pruning + auto-backup logic)
 *  - src/features/backup/icloud.ts  (iCloud storage adapter)
 *  - DB repositories and settings
 */
import type { File } from 'expo-file-system';
import { parseBackup, BackupData } from '../../lib/backup';
import {
  pruneTolerantly,
  backupSignature,
  shouldAutoBackup,
  settingsForBackup,
  resolveAutoBackupEnabled,
} from '../../domain/backupPolicy';
import { runExclusive, exclusive, ExclusiveEffect } from '../../domain/backupGate';
import { restoreRouteFor } from '../../domain/backupFilename';
import { runRestoreSequence } from '../../domain/restoreSequence';
import { newId } from '../../lib/id';
import * as icloud from './icloud';
import {
  backupScratchFile,
  restoreScratchFile,
  deleteScratchFileIfExists,
  exportPlaintextSnapshot,
  readBackupDataFromAttached,
  toSqlitePath,
} from './sqliteFile';
import { listAccounts } from '../accounts/repository';
import { listCategories } from '../categories/repository';
import { listPayees } from '../payees/repository';
import { listTransactions } from '../transactions/repository';
import { listSeries, postDueOccurrences } from '../recurring/repository';
import {
  getAllSettings,
  getSetting,
  setSetting,
  applySettings,
  getDataRevision,
  bumpDataRevision,
} from '../settings/repository';
import { updateWidgetSummary } from '../widget/summary';
import { db, expoDb } from '../../db/client';
import * as schema from '../../db/schema';

/** Keep the 3 newest backups, prune the rest. */
export const KEEP = 3;

/** Minimum time between auto-backups (1 hour in ms). */
export const MIN_AUTO_INTERVAL_MS = 3_600_000;

// ─── Gather ──────────────────────────────────────────────────────────────────

/**
 * Read every domain entity from the local DB and return a BackupData
 * snapshot. Excludes backup bookkeeping settings (backup_last_sig,
 * backup_last_at) and device-local settings (biometric_lock,
 * backup_auto_enabled, theme) — see SETTINGS_EXCLUDED_FROM_BACKUP.
 *
 * Since assessment M3, this is used ONLY to compute `backupSignature` for
 * `maybeAutoBackup`'s "has anything changed" check — the actual backup file
 * (`createBackupUnlocked`) is a whole-DB SQLite image
 * (`exportPlaintextSnapshot`), not a serialisation of this snapshot.
 */
export async function gatherBackupData(): Promise<BackupData> {
  const [accounts, categories, payees, transactions, recurringSeries, allSettings, dataRevision] =
    await Promise.all([
      listAccounts(),
      listCategories(),
      listPayees(),
      listTransactions(),
      listSeries(),
      getAllSettings(),
      getDataRevision(),
    ]);

  // Strip bookkeeping + device-local keys that should not be part of the snapshot.
  const settings = settingsForBackup(allSettings);

  return { accounts, categories, payees, transactions, recurringSeries, settings, dataRevision };
}

// ─── Apply (restore) ─────────────────────────────────────────────────────────

/**
 * Apply a backup dataset to the local DB.
 *
 * This is the critical, destructive restore path:
 *  1. Wraps everything in a single SQLite transaction — failure rolls back, so the
 *     DB is never left in a half-wiped state.
 *  2. Deletes ALL rows from every data table.
 *  3. Re-inserts every row id-preserving (raw Drizzle inserts, NOT create* helpers
 *     which would mint new ids and orphan references).
 *  4. Applies settings outside the transaction (settings table is fine to partial-apply).
 *  5. Runs postDueOccurrences to catch up any missed recurring occurrences.
 *
 * The whole body runs inside the backup gate (src/domain/backupGate.ts) so it
 * can never interleave with a concurrent manual/auto backup snapshot (H1):
 * expo-sqlite's shared connection is unsafe against concurrent statements, so
 * a backup's SELECTs interleaving with this restore's DELETEs/INSERTs could
 * serialize a half-wiped dataset as the newest backup.
 */
export const applyBackup: ExclusiveEffect<BackupData> = exclusive(applyBackupUnlocked);

async function applyBackupUnlocked(data: BackupData): Promise<void> {
  await expoDb.withTransactionAsync(async () => {
    // Clear every data table (order matters for FK constraints, but SQLite
    // typically has FK enforcement off by default in expo-sqlite).
    await db.delete(schema.transactions);
    await db.delete(schema.recurringSeries);
    await db.delete(schema.payees);
    await db.delete(schema.categories);
    await db.delete(schema.accounts);

    // Re-insert accounts
    for (const acc of data.accounts) {
      await db.insert(schema.accounts).values({
        id: acc.id,
        name: acc.name,
        tag: acc.tag ?? null,
        subtype: acc.subtype ?? null,
        icon: acc.icon ?? null,
        currency: acc.currency,
        openingBalance: acc.openingBalance,
        archived: acc.archived ?? false,
      });
    }

    // Re-insert categories
    for (const cat of data.categories) {
      await db.insert(schema.categories).values({
        id: cat.id,
        name: cat.name,
        kind: cat.kind,
        parentId: cat.parentId ?? null,
        icon: cat.icon ?? null,
      });
    }

    // Re-insert payees
    for (const payee of data.payees) {
      await db.insert(schema.payees).values({
        id: payee.id,
        name: payee.name,
        defaultCategoryId: payee.defaultCategoryId ?? null,
      });
    }

    // Re-insert transactions
    for (const tx of data.transactions) {
      await db.insert(schema.transactions).values({
        id: tx.id,
        accountId: tx.accountId,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        categoryId: tx.categoryId ?? null,
        payeeId: tx.payeeId ?? null,
        transferAccountId: tx.transferAccountId ?? null,
        note: tx.note ?? null,
        occurredAt: tx.occurredAt,
        createdAt: tx.createdAt,
        source: tx.source,
        receiptRef: tx.receiptRef ?? null,
        sourceText: tx.sourceText ?? null,
        seriesId: tx.seriesId ?? null,
        occurrenceDate: tx.occurrenceDate ?? null,
        pending: tx.pending ?? false,
      });
    }

    // Re-insert recurring series (rule, template, skippedDates stored as JSON text)
    for (const series of data.recurringSeries) {
      await db.insert(schema.recurringSeries).values({
        id: series.id,
        rule: JSON.stringify(series.rule),
        template: JSON.stringify(series.template),
        lastPostedAt: series.lastPostedAt ?? null,
        postedCount: series.postedCount,
        paused: series.paused,
        skippedDates: JSON.stringify(series.skippedDates),
        createdAt: series.createdAt,
        archived: series.archived,
      });
    }
  });

  // Apply settings after the transaction (upserts each key individually).
  if (data.settings) {
    await applySettings(data.settings);
  }

  // Post any recurring occurrences that became due after restore.
  await postDueOccurrences(Date.now());

  // The whole dataset was just replaced wholesale — bump once here (rather
  // than relying on the per-row bumps inside postDueOccurrences, which only
  // fire if catch-up posting actually inserted something) so a restore that
  // changes the ledger without posting anything new still forces a fresh
  // backup on the next backgrounding (review F3 / M4, acceptance #4).
  await bumpDataRevision();

  // The whole dataset just changed under the widget's feet — recompute its
  // summary rather than waiting for the next transaction save.
  void updateWidgetSummary();
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new backup (assessment M3 — plaintext SQLite, not JSON):
 *  1. Export a PLAINTEXT SQLite snapshot of the keyed live DB to a scratch
 *     file via SQLCipher's `sqlcipher_export` (`exportPlaintextSnapshot`) —
 *     a whole-DB image, so it can't miss a column the way the old
 *     `gatherBackupData`/JSON serialiser could.
 *  2. Upload the scratch file to iCloud as binary (`icloud.uploadFile`) with
 *     a timestamped `.sqlite` filename.
 *  3. Delete the scratch file.
 *  4. Prune old backups beyond the KEEP limit via `pruneTolerantly`
 *     (src/domain/backupPolicy.ts) — mixed `.sqlite`/`.json` list
 *     (`selectBackupsToPrune` only looks at `exportedAt`, so suffix doesn't
 *     matter); tolerant of a LISTING failure, not just a per-file delete
 *     failure (QA round 3 B1) — the backup above already succeeded by the
 *     time this runs, so a listing failure (e.g. a slow first
 *     NSMetadataQuery gather) must not fail the whole create.
 *
 * Runs inside the backup gate (H1) so it can never interleave with a
 * concurrent restore (`applyBackup`). Non-destructive: a partial/interrupted
 * create just leaves a stray remote file, which the next prune removes.
 */
export async function createBackup(): Promise<void> {
  await runExclusive(createBackupUnlocked);
}

/** Exported (not just used internally by `createBackup`/`maybeAutoBackup`)
 *  so `src/features/accounts/repository.ts`'s `deleteAccountCascade` can run
 *  a FORCED pre-delete backup from inside its OWN `runExclusive` section
 *  (docs/design/account-chat-crud-spec.md §5.4) — calling this unlocked
 *  variant directly, never the gated `createBackup` export, avoids
 *  re-entering the gate (see backupGate.ts; same pattern `restoreFromSqlite`
 *  already uses for `applyBackupUnlocked`). This creates a deliberate two-file
 *  import cycle with accounts/repository.ts (which this file already imports
 *  `listAccounts` from) — safe here because both sides only ever call each
 *  other's exports from inside async function bodies, never at module-eval
 *  time (same precedent as transactions/repository.ts <-> widget/summary.ts). */
export async function createBackupUnlocked(): Promise<void> {
  const now = Date.now();
  // Names the device idiom that made it (docs/design/icloud-backup-sync-spec.md,
  // I5) — the Backups screen shows "iPhone ·"/"iPad ·" for these and "Backup
  // ·" for anything made before this shipped.
  const name = icloud.buildName(now, icloud.deviceKind());
  const file = backupScratchFile(now);
  deleteScratchFileIfExists(file); // clear a stale leftover before exporting fresh
  try {
    await exportPlaintextSnapshot(expoDb, file);
    await icloud.uploadFile(name, toSqlitePath(file.uri));
  } finally {
    deleteScratchFileIfExists(file);
  }

  // Prune old backups — listing failures are non-fatal too now (B1); see
  // pruneTolerantly's own doc comment.
  await pruneTolerantly(icloud.list, icloud.remove, KEEP);
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * List all available backups with their live cloud status, newest first
 * (docs/design/icloud-backup-sync-spec.md, I2/I4) — a thin re-export of
 * `icloud.listWithStatus`, kept here so callers (the Backups screen) only
 * ever import from the repository, not the adapter directly.
 */
export async function listBackups(): Promise<icloud.CloudBackupEntry[]> {
  return icloud.listWithStatus();
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a specific backup file by name, routed by suffix
 * (`restoreRouteFor`, assessment M3):
 *  - `.sqlite` (new): download the binary snapshot, validate every row, and
 *    apply it via the existing `applyBackupUnlocked` (`restoreFromSqlite`).
 *  - `.json` (legacy, unchanged): read as a string, parse, and apply via the
 *    existing `applyBackup` — so pre-M3 backups still restore.
 *
 * `onProgress` (docs/design/icloud-backup-sync-spec.md, I4) is passed
 * through to `ensureDownloaded` on both routes — the download happens
 * BEFORE anything destructive, so waiting for it (and reporting how far
 * along it is) is safe on either path (D2).
 *
 * Both routes below run through `runRestoreSequence`
 * (src/domain/restoreSequence.ts, QA round 1 Major 2) — a pure,
 * Node-tested sequencer that strictly orders "wait for the download, then
 * read the backup, then apply it" — so a future edit that reorders or drops
 * the `ensureDownloaded` step breaks a named scenario, not just a QA trace.
 */
export async function restoreFromName(
  name: string,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  if (restoreRouteFor(name) === 'sqlite') {
    await restoreFromSqlite(name, onProgress);
    return;
  }
  await runRestoreSequence<BackupData>({
    ensureDownloaded: () => icloud.ensureDownloaded(name, onProgress),
    readBackup: async () => {
      const json = await icloud.read(name);
      return parseBackup(json).data;
    },
    apply: applyBackup,
  });
}

/**
 * Restore from a `.sqlite` backup, via `runRestoreSequence`:
 *  1. `ensureDownloaded` (D2) — wait for it to be fully on this device,
 *     BEFORE the scratch file's contents are even touched. This is the
 *     only new wait; it happens strictly before any of the destructive
 *     steps below, and nothing about the existing gate/section changes.
 *  2. `readBackup` — copy it to the scratch file (a unique per-call name,
 *     `newId()`, so two restores kicked off close together never race on
 *     the same destination — `copyToScratch`/`downloadFile` throw if the
 *     destination already exists) via `copyToScratch`, the module's
 *     coordinated copy when linked, else the library's `downloadFile`
 *     (today's behaviour).
 *  3. `apply` — under the SAME H1 exclusivity gate as the JSON path, wrapped
 *     in exactly one `exclusive()` call (`src/domain/backupGate.ts`, QA
 *     round 2 Major — `apply` is typed `ExclusiveEffect<TData>`, so passing
 *     an unwrapped function here is a `npm run typecheck` failure, not a
 *     silent gap): attach the file and read+validate every row of every
 *     table into a `BackupData` (`readBackupDataFromAttached` — read-only,
 *     touches no live table), then hand that straight to the EXISTING
 *     `applyBackupUnlocked` — the exact same wipe-and-reinsert-by-named-
 *     column function the legacy `.json` path uses via `applyBackup`.
 *     (Calling the unlocked variant directly, not the gated `applyBackup`
 *     export, avoids re-entering the chain — see backupGate.ts's "not
 *     re-entrant" note.) The attach-and-read stays bundled with apply
 *     inside the SAME `exclusive()` wrap exactly as before
 *     `runRestoreSequence` existed — splitting them across the gate would
 *     reopen the very race the gate exists to prevent (a concurrent
 *     auto-backup's own use of the shared `expoDb` connection).
 *     `readBackup` here only materialises the local copy; the file
 *     reference IS the `TData` `runRestoreSequence` passes to `apply`.
 *
 * If step 3's row validation rejects anything, it throws before
 * `applyBackupUnlocked` is ever called — no live table is wiped.
 */
async function restoreFromSqlite(
  name: string,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  const file = restoreScratchFile(newId());
  deleteScratchFileIfExists(file); // paranoia: guarantee a clean destination
  try {
    await runRestoreSequence({
      ensureDownloaded: () => icloud.ensureDownloaded(name, onProgress),
      readBackup: async () => {
        await icloud.copyToScratch(name, toSqlitePath(file.uri));
        return file;
      },
      apply: exclusive(async (f: File) => {
        const data = await readBackupDataFromAttached(expoDb, f);
        await applyBackupUnlocked(data);
      }),
    });
  } finally {
    deleteScratchFileIfExists(file);
  }
}

// `restoreLatest` (a "prefer the newest already-restorable entry" helper)
// was deleted here (QA round 3 minor 3) — zero callers, same principle as
// deleting `parseExportedAt`'s re-export: a function kept alive on the
// chance a future caller wants it is backwards. Re-add it, with a test
// that protects something real, if a caller actually needs it.

// ─── Auto-backup ─────────────────────────────────────────────────────────────

/**
 * Opportunistically auto-backup if conditions are met:
 *  - Auto-backup is enabled — opt-out: on unless `backup_auto_enabled` is
 *    explicitly `'0'` (see `resolveAutoBackupEnabled`,
 *    src/domain/backupPolicy.ts). An unset value counts as enabled.
 *  - iCloud is available.
 *  - Data has changed since the last backup (signature differs).
 *  - At least MIN_AUTO_INTERVAL_MS has elapsed since the last backup.
 *
 * Never throws — errors are logged and swallowed so the app cannot crash.
 *
 * The gather + signature check + write run inside the backup gate (H1) — as
 * one exclusive section, calling `createBackupUnlocked` (never the wrapped
 * `createBackup` export, which would deadlock re-entering the gate) — so a
 * concurrent restore can never interleave with this snapshot. Gathering
 * outside the gate would reopen the race.
 */
export async function maybeAutoBackup(): Promise<void> {
  try {
    await runExclusive(async () => {
      const autoEnabled = await getSetting('backup_auto_enabled');
      if (!resolveAutoBackupEnabled(autoEnabled)) return;

      const available = await icloud.isAvailable();
      if (!available) return;

      const data = await gatherBackupData();
      const sig = backupSignature(data);

      const lastSig = await getSetting('backup_last_sig');
      const lastAtRaw = await getSetting('backup_last_at');
      const lastAt = lastAtRaw ? Number(lastAtRaw) : 0;

      if (!shouldAutoBackup(sig, lastSig, Date.now(), lastAt, MIN_AUTO_INTERVAL_MS)) return;

      await createBackupUnlocked();

      const now = Date.now();
      await setSetting('backup_last_sig', sig);
      await setSetting('backup_last_at', String(now));
    });
  } catch (e) {
    // Never crash the app — auto-backup is opportunistic.
    console.warn('Auto-backup failed:', e);
  }
}
