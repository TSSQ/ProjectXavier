/**
 * App-Group summary writer for the home/lock-screen widget.
 *
 * The widget process (targets/widget) can't touch Drizzle/SQLite — it never
 * imports app JS at all — so this file is the ONLY bridge between the two:
 * it computes the current-calendar-month totals over every active account
 * and drops a small JSON file into the shared App Group container, then asks
 * WidgetKit to redraw (the widget's own timeline policy is `.never`; it only
 * updates when told to).
 *
 * Call sites (documented here so they don't drift):
 *  - src/features/transactions/repository.ts — createTransaction,
 *    updateTransaction, deleteTransaction (the narrowest chokepoint: every
 *    save/edit/delete path — assistant, manual add, per-account screens —
 *    funnels through these three functions).
 *  - src/features/backup/repository.ts — applyBackup (restore-from-backup).
 *  - app/(tabs)/settings.tsx — onPickCurrency (currency changes the
 *    summary's own `currency` field).
 *  - app/_layout.tsx — once at startup (covers the first-run case, where no
 *    summary file exists yet, and picks up any recurring transactions
 *    auto-posted by postDueOccurrences just before it) and on the
 *    active→background AppState transition (reuses the existing single
 *    listener; see the comment there).
 *
 * Never throws: a widget-summary failure must never surface to the user or
 * interrupt whatever the caller was actually trying to do.
 */
import { Paths, File } from 'expo-file-system';
import { listAccounts } from '../accounts/repository';
import { listTransactions } from '../transactions/repository';
import { getCurrency } from '../settings/repository';
import { periodRange, totalsForRange } from '../../domain/period';
import { monthLabel } from '../../domain/dates';
import { reloadWidgets } from '../../../modules/widget-bridge';

/** Must match targets/widget/expo-target.config.js and app.config.ts's
 *  `ios.entitlements['com.apple.security.application-groups']`. */
export const WIDGET_APP_GROUP = 'group.com.projectxavier.app';
const SUMMARY_FILE_NAME = 'widget-summary.json';
// Scratch file used to make the real write below atomic-ish — see writeSummary().
const SUMMARY_TMP_FILE_NAME = 'widget-summary.json.tmp';
const SUMMARY_VERSION = 1;

/** Mirrors targets/widget/WidgetSummary.swift's Decodable shape exactly. */
export interface WidgetSummary {
  version: number;
  periodLabel: string;
  incomeMinor: number;
  expenseMinor: number;
  currency: string;
  updatedAt: number;
}

/**
 * Recompute the current-calendar-month income/expense across every active
 * (non-archived) account, write it to the App Group container, then ask
 * WidgetKit to reload. Swallows every error — see the file header.
 */
export async function updateWidgetSummary(now: number = Date.now()): Promise<void> {
  try {
    const [accounts, transactions, currency] = await Promise.all([
      listAccounts(),
      listTransactions(),
      getCurrency(),
    ]);
    const activeAccountIds = new Set(
      accounts.filter((a) => !a.archived).map((a) => a.id)
    );
    const scoped = transactions.filter((t) => activeAccountIds.has(t.accountId));
    const totals = totalsForRange(scoped, periodRange(now, 'month'));

    const summary: WidgetSummary = {
      version: SUMMARY_VERSION,
      periodLabel: monthLabel(now),
      incomeMinor: totals.income,
      expenseMinor: totals.expense,
      currency,
      updatedAt: now,
    };

    writeSummary(summary);
    reloadWidgets();
  } catch (e) {
    // Widget staleness is never worth surfacing to the user.
    console.warn('updateWidgetSummary failed:', e);
  }
}

/**
 * Writes `summary` as JSON into the App Group container.
 *
 * Uses expo-file-system's shared-container API (`Paths.appleSharedContainers`,
 * backed by `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`
 * — see node_modules/expo-file-system/ios/FileSystemModule.swift), available
 * on the installed SDK 54 / expo-file-system ~19.0. This means no native
 * module is needed for the write half of this feature — only reloadWidgets()
 * (the WidgetKit reload call) needs one, via modules/widget-bridge.
 *
 * Atomicity: `File.write()` writes straight to the target path
 * (`atomically: false` under the hood — see `write(_ content: String)` in
 * node_modules/expo-file-system/ios/FileSystemFile.swift), so writing
 * SUMMARY_FILE_NAME in place could let the widget process — a separate,
 * concurrently-reading process — observe a torn/partial JSON file mid-write.
 * The widget's decode is defensive either way (a torn read just degrades to
 * the launcher layout), but that's avoidably stale, so this instead:
 *   1. Writes the FULL content to a scratch file first (the only non-atomic
 *      step, but nothing else knows that path, so nothing can read it
 *      mid-write).
 *   2. Deletes any existing SUMMARY_FILE_NAME (expo-file-system's `move()` —
 *      a `rename(2)` under the hood, atomic on the same volume — throws if
 *      the destination already exists, so it can't replace it directly).
 *   3. Moves the scratch file onto SUMMARY_FILE_NAME (the atomic rename).
 * This is the strongest primitive this API exposes: the only remaining
 * window is step 2→3, where the file is briefly ABSENT rather than
 * corrupt — the widget's decode already treats "missing file" as "no
 * summary yet" and falls back to the launcher layout, so that window is
 * safe by construction, unlike the previous in-place write's torn-read window.
 */
function writeSummary(summary: WidgetSummary): void {
  const dir = Paths.appleSharedContainers[WIDGET_APP_GROUP];
  if (!dir) {
    // App Group entitlement missing/not yet provisioned on this build —
    // nothing to write; the widget just keeps showing its launcher layout.
    return;
  }
  const tmp = new File(dir, SUMMARY_TMP_FILE_NAME);
  const dest = new File(dir, SUMMARY_FILE_NAME);
  tmp.write(JSON.stringify(summary));
  if (dest.exists) {
    dest.delete();
  }
  tmp.move(dest);
}
