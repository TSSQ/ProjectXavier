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
 *    funnels through these three functions). These SCHEDULE a refresh
 *    (debounced), so a burst of saves — a statement import — costs one.
 *  - src/features/accounts/repository.ts — account delete.
 *  - src/features/backup/repository.ts — applyBackup (restore-from-backup).
 *  - app/(tabs)/settings.tsx — onPickCurrency (currency changes the
 *    summary's own `currency` field).
 *  - app/_layout.tsx — once at startup (covers the first-run case, where no
 *    summary file exists yet, and picks up any recurring transactions
 *    auto-posted by postDueOccurrences just before it) and on the
 *    background AppState transition (reuses the existing single listener;
 *    see the comment there).
 *
 * Everything except the save path refreshes immediately (and cancels any
 * scheduled refresh). A refresh is one parameterised SQL aggregate, and a
 * result the widget would draw identically is not rewritten (issue #27 —
 * see src/domain/widgetSummary.ts).
 *
 * Never throws: a widget-summary failure must never surface to the user or
 * interrupt whatever the caller was actually trying to do.
 */
import { Paths, File } from 'expo-file-system';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { accounts, transactions } from '../../db/schema';
import { getCurrency } from '../settings/repository';
import { monthLabel } from '../../domain/dates';
import {
  createDebounced,
  widgetCountedWindow,
  widgetSummaryKey,
} from '../../domain/widgetSummary';
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

/** Long enough to fold a statement import's saves into one refresh, short
 *  enough that the widget is current by the time the user can look at it. */
const SAVE_DEBOUNCE_MS = 1500;

// Key of the summary last written this process; null until the first write,
// so every launch writes once (the file may predate a restore or an update).
let lastWrittenKey: string | null = null;
// Refreshes run one at a time so an older result can never land last.
let queue: Promise<void> = Promise.resolve();

/** This month's counted income/expense over active accounts — one query. */
async function monthTotals(now: number): Promise<{ income: number; expense: number }> {
  const { start, end } = widgetCountedWindow(now);
  const rows = await db
    .select({
      type: transactions.type,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(accounts.archived, false),
        eq(transactions.pending, false),
        inArray(transactions.type, ['income', 'expense']),
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end)
      )
    )
    .groupBy(transactions.type);
  const total = (type: string) => Number(rows.find((r) => r.type === type)?.total ?? 0);
  return { income: total('income'), expense: total('expense') };
}

async function refresh(now: number): Promise<void> {
  try {
    const [totals, currency] = await Promise.all([monthTotals(now), getCurrency()]);
    const summary: WidgetSummary = {
      version: SUMMARY_VERSION,
      periodLabel: monthLabel(now),
      incomeMinor: totals.income,
      expenseMinor: totals.expense,
      currency,
      updatedAt: now,
    };
    const key = widgetSummaryKey(summary);
    if (key === lastWrittenKey) return;

    writeSummary(summary);
    lastWrittenKey = key;
    reloadWidgets();
  } catch (e) {
    // Widget staleness is never worth surfacing to the user.
    console.warn('updateWidgetSummary failed:', e);
  }
}

function enqueue(now: number): Promise<void> {
  queue = queue.then(() => refresh(now));
  return queue;
}

const debounced = createDebounced(() => void enqueue(Date.now()), SAVE_DEBOUNCE_MS, {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

/**
 * Refresh now: recompute this month's income/expense across every active
 * (non-archived) account, and — if the widget would draw anything different
 * — write it to the App Group container and ask WidgetKit to reload. Cancels
 * any scheduled refresh (this one supersedes it). Swallows every error — see
 * the file header.
 */
export function updateWidgetSummary(now: number = Date.now()): Promise<void> {
  debounced.cancel();
  return enqueue(now);
}

/** Refresh after a short quiet period — for the per-save chokepoints. */
export function scheduleWidgetSummaryUpdate(): void {
  debounced.schedule();
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
