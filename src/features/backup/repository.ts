/**
 * Backup orchestration: gather, create, list, restore, and auto-backup.
 *
 * This module ties together:
 *  - src/lib/backup.ts  (pure serialisation)
 *  - src/domain/backupPolicy.ts  (pure pruning + auto-backup logic)
 *  - src/features/backup/icloud.ts  (iCloud storage adapter)
 *  - DB repositories and settings
 */
import { serializeBackup, parseBackup, BackupData } from '../../lib/backup';
import { selectBackupsToPrune, backupSignature, shouldAutoBackup } from '../../domain/backupPolicy';
import * as icloud from './icloud';
import { listAccounts } from '../accounts/repository';
import { listCategories } from '../categories/repository';
import { listPayees } from '../payees/repository';
import { listTransactions } from '../transactions/repository';
import { listSeries, postDueOccurrences } from '../recurring/repository';
import { getAllSettings, getSetting, setSetting, applySettings } from '../settings/repository';
import { updateWidgetSummary } from '../widget/summary';
import { db, expoDb } from '../../db/client';
import * as schema from '../../db/schema';

/** Keep the 3 newest backups, prune the rest. */
export const KEEP = 3;

/** Minimum time between auto-backups (1 hour in ms). */
export const MIN_AUTO_INTERVAL_MS = 3_600_000;

// ─── Gather ──────────────────────────────────────────────────────────────────

/**
 * Read every domain entity from the local DB and return a BackupData snapshot.
 * Excludes backup bookkeeping settings (backup_last_sig, backup_last_at).
 */
export async function gatherBackupData(): Promise<BackupData> {
  const [accounts, categories, payees, transactions, recurringSeries, allSettings] =
    await Promise.all([
      listAccounts(),
      listCategories(),
      listPayees(),
      listTransactions(),
      listSeries(),
      getAllSettings(),
    ]);

  // Strip bookkeeping keys that should not be part of the snapshot.
  const settings = { ...allSettings };
  delete settings['backup_last_sig'];
  delete settings['backup_last_at'];

  return { accounts, categories, payees, transactions, recurringSeries, settings };
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
 */
export async function applyBackup(data: BackupData): Promise<void> {
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

  // The whole dataset just changed under the widget's feet — recompute its
  // summary rather than waiting for the next transaction save.
  void updateWidgetSummary();
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new backup:
 *  1. Gather current data.
 *  2. Serialize to JSON.
 *  3. Write to iCloud with a timestamped filename.
 *  4. Prune old backups beyond the KEEP limit.
 */
export async function createBackup(): Promise<void> {
  const now = Date.now();
  const data = await gatherBackupData();
  const json = serializeBackup(data, now);
  const name = icloud.buildName(now);
  await icloud.write(name, json);

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

/** Restore a specific backup file by name. */
export async function restoreFromName(name: string): Promise<void> {
  const json = await icloud.read(name);
  const envelope = parseBackup(json);
  await applyBackup(envelope.data);
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
 *  - Auto-backup is enabled (backup_auto_enabled === '1').
 *  - iCloud is available.
 *  - Data has changed since the last backup (signature differs).
 *  - At least MIN_AUTO_INTERVAL_MS has elapsed since the last backup.
 *
 * Never throws — errors are logged and swallowed so the app cannot crash.
 */
export async function maybeAutoBackup(): Promise<void> {
  try {
    const autoEnabled = await getSetting('backup_auto_enabled');
    if (autoEnabled !== '1') return;

    const available = await icloud.isAvailable();
    if (!available) return;

    const data = await gatherBackupData();
    const sig = backupSignature(data);

    const lastSig = await getSetting('backup_last_sig');
    const lastAtRaw = await getSetting('backup_last_at');
    const lastAt = lastAtRaw ? Number(lastAtRaw) : 0;

    if (!shouldAutoBackup(sig, lastSig, Date.now(), lastAt, MIN_AUTO_INTERVAL_MS)) return;

    await createBackup();

    const now = Date.now();
    await setSetting('backup_last_sig', sig);
    await setSetting('backup_last_at', String(now));
  } catch (e) {
    // Never crash the app — auto-backup is opportunistic.
    console.warn('Auto-backup failed:', e);
  }
}
