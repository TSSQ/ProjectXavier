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
import { parseBackup, BackupData } from '../../lib/backup';
import {
  selectBackupsToPrune,
  backupSignature,
  shouldAutoBackup,
  settingsForBackup,
  resolveAutoBackupEnabled,
} from '../../domain/backupPolicy';
import { runExclusive } from '../../domain/backupGate';
import { restoreRouteFor } from '../../domain/backupFilename';
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
export async function applyBackup(data: BackupData): Promise<void> {
  await runExclusive(() => applyBackupUnlocked(data));
}

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
 *  4. Prune old backups beyond the KEEP limit (mixed `.sqlite`/`.json` list —
 *     `selectBackupsToPrune` only looks at `exportedAt`, so suffix doesn't
 *     matter).
 *
 * Runs inside the backup gate (H1) so it can never interleave with a
 * concurrent restore (`applyBackup`). Non-destructive: a partial/interrupted
 * create just leaves a stray remote file, which the next prune removes.
 */
export async function createBackup(): Promise<void> {
  await runExclusive(createBackupUnlocked);
}

async function createBackupUnlocked(): Promise<void> {
  const now = Date.now();
  const name = icloud.buildName(now);
  const file = backupScratchFile(now);
  deleteScratchFileIfExists(file); // clear a stale leftover before exporting fresh
  try {
    await exportPlaintextSnapshot(expoDb, file);
    await icloud.uploadFile(name, toSqlitePath(file.uri));
  } finally {
    deleteScratchFileIfExists(file);
  }

  // Prune old backups.
  const allBackups = await icloud.list();
  const toDelete = selectBackupsToPrune(allBackups, KEEP);
  for (const fileName of toDelete) {
    try {
      await icloud.remove(fileName);
    } catch {
      // Non-fatal: pruning failure should not block the backup.
    }
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

/** List all available backups, newest first. */
export async function listBackups(): Promise<{ name: string; exportedAt: number; size: number }[]> {
  const metas = await icloud.list();
  return metas.sort((a, b) => b.exportedAt - a.exportedAt);
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a specific backup file by name, routed by suffix
 * (`restoreRouteFor`, assessment M3):
 *  - `.sqlite` (new): download the binary snapshot, validate every row, and
 *    apply it via the existing `applyBackupUnlocked` (`restoreFromSqlite`).
 *  - `.json` (legacy, unchanged): read as a string, parse, and apply via the
 *    existing `applyBackup` — so pre-M3 backups still restore.
 */
export async function restoreFromName(name: string): Promise<void> {
  if (restoreRouteFor(name) === 'sqlite') {
    await restoreFromSqlite(name);
    return;
  }
  const json = await icloud.read(name);
  const envelope = parseBackup(json);
  await applyBackup(envelope.data);
}

/**
 * Restore from a `.sqlite` backup:
 *  1. Download it to a scratch file with a unique per-call name (`newId()`)
 *     — NOT a fixed filename, so two restores kicked off close together
 *     never race on the same download destination (`downloadFile` throws if
 *     its destination already exists).
 *  2. Under the SAME H1 exclusivity gate as the JSON path, in one
 *     `runExclusive` section: attach the file and read+validate every row of
 *     every table into a `BackupData` (`readBackupDataFromAttached` —
 *     read-only, touches no live table), then hand that straight to the
 *     EXISTING `applyBackupUnlocked` — the exact same wipe-and-reinsert-by-
 *     -named-column function the legacy `.json` path uses via `applyBackup`.
 *     (Calling the unlocked variant directly, not the gated `applyBackup`
 *     export, avoids re-entering `runExclusive` — see backupGate.ts.)
 *  3. Delete the scratch file.
 *
 * If step 2's row validation rejects anything, it throws before
 * `applyBackupUnlocked` is ever called — no live table is wiped.
 */
async function restoreFromSqlite(name: string): Promise<void> {
  const file = restoreScratchFile(newId());
  deleteScratchFileIfExists(file); // paranoia: guarantee a clean destination
  try {
    await icloud.downloadFile(name, toSqlitePath(file.uri));
    await runExclusive(async () => {
      const data = await readBackupDataFromAttached(expoDb, file);
      await applyBackupUnlocked(data);
    });
  } finally {
    deleteScratchFileIfExists(file);
  }
}

/** Restore the most recent backup. Throws if no backups exist. */
export async function restoreLatest(): Promise<void> {
  const backups = await listBackups();
  if (backups.length === 0) throw new Error('No backups found');
  await restoreFromName(backups[0]!.name);
}

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
