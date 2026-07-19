/**
 * App-level preferences (key/value), persisted via Drizzle / parameterised SQL.
 *
 * Currency lives here rather than on each account: the app uses a single display
 * currency (no per-account currency, no FX). Accounts and transactions still
 * carry a `currency` column, but it always mirrors this setting.
 */
import { eq, sql } from 'drizzle-orm';
import { db, expoDb } from '../../db/client';
import { settings, accounts, transactions, recurringSeries } from '../../db/schema';
import { resolveBiometricLock } from '../../domain/biometricLock';
import { resolveOnboardingComplete } from '../../domain/onboardingComplete';
import { settingsForRestore } from '../../domain/backupPolicy';
import { runExclusive } from '../../domain/backupGate';
import { RecurrenceTemplate } from '../../domain/types';
import {
  canChangeCurrencyFreely as canChangeCurrencyFreelyPure,
  relabelCurrencyWithStore,
  RelabelStore,
} from '../../domain/currencyRelabel';
// Re-exported for callers (e.g. app/(tabs)/settings.tsx) — the list itself
// lives in domain/currency.ts (framework-free) so it stays Node-testable
// alongside currencyExponent; this file depends on expo-sqlite and isn't.
export { SUPPORTED_CURRENCIES } from '../../domain/currency';

export const DEFAULT_CURRENCY = 'SGD';
const CURRENCY_KEY = 'currency';
const AVATAR_LOOK_KEY = 'avatar_look';
const AVATAR_KIND_KEY = 'avatar_kind';
const THEME_KEY = 'theme';
const BIOMETRIC_LOCK_KEY = 'biometric_lock';
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';
const DATA_REVISION_KEY = 'data_revision';

export type ThemePreference = 'system' | 'light' | 'dark';
const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  // Upsert: settings has one row per key.
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * Application-managed monotonic counter, bumped by every financial mutation
 * (transactions/accounts/categories/payees/recurring create-update-delete
 * chokepoints, plus restore — see docs/design/backup-data-revision-spec.md)
 * and folded into `backupSignature` (src/domain/backupPolicy.ts). This is
 * what fixes review F3: editing an existing row reuses its original
 * `createdAt`, so the old row-count/max-createdAt signature never noticed an
 * edit — this counter does, because every mutation bumps it regardless of
 * whether it's an insert, update, or delete.
 *
 * One parameterised upsert: absent row writes `1`; an existing row is
 * incremented in place via a SQL expression (not read-then-write), so two
 * concurrent bumps can't race and lose an increment.
 *
 * Device-local (`DEVICE_LOCAL_SETTINGS_KEYS`, src/domain/backupPolicy.ts) —
 * a device-lifetime counter, not ledger content, so it is excluded from the
 * backup snapshot and never applied on restore.
 */
export async function bumpDataRevision(): Promise<void> {
  await db
    .insert(settings)
    .values({ key: DATA_REVISION_KEY, value: '1' })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`CAST(${settings.value} AS INTEGER) + 1` },
    });
}

/** Current data-revision counter; 0 if never bumped (fresh install, or an
 *  existing install that hasn't made a mutation since this fix shipped). */
export async function getDataRevision(): Promise<number> {
  const raw = await getSetting(DATA_REVISION_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function getCurrency(): Promise<string> {
  return (await getSetting(CURRENCY_KEY)) ?? DEFAULT_CURRENCY;
}

export async function setCurrency(code: string): Promise<void> {
  await setSetting(CURRENCY_KEY, code);
}

// ─── Currency relabel (review F1 / M7) ──────────────────────────────────────
//
// The app is single-currency: changing the currency setting RELABELS every
// stored amount (never converts — no FX, no rates). `relabelCurrency` is the
// only way this setting should ever change once any data exists (Settings'
// UI gates a bare `setCurrency` behind either an empty ledger or the user's
// explicit confirm on the warn-not-convert modal). The actual algorithm is
// the pure, Node-testable `relabelCurrencyWithStore` (src/domain/
// currencyRelabel.ts) — this just wires it to the real Drizzle tables.

/** True only when the ledger is truly empty (no accounts, no transactions) —
 *  Settings may then change currency without the warn+confirm modal. */
export async function canChangeCurrencyFreely(): Promise<boolean> {
  const [acctRows, txRows] = await Promise.all([
    db.select({ id: accounts.id }).from(accounts).limit(1),
    db.select({ id: transactions.id }).from(transactions).limit(1),
  ]);
  return canChangeCurrencyFreelyPure({
    accountCount: acctRows.length,
    transactionCount: txRows.length,
  });
}

/** The live Drizzle-backed `RelabelStore` — every write is a parameterised
 *  Drizzle statement (guardrail #4). `runInTransaction` uses expo-sqlite's own
 *  transaction API (`expoDb.withTransactionAsync`, not Drizzle's own
 *  `db.transaction`, which cannot safely await mid-callback on this driver —
 *  see applyBackupUnlocked in src/features/backup/repository.ts for the same
 *  pattern), so every row rewrite below either all commit or all roll back.
 *
 *  IMPORTANT: `withTransactionAsync` alone is NOT enough — expo-sqlite's
 *  shared connection is not exclusive against other async queries run while
 *  the transaction is in flight (this is why backup/restore already need
 *  their own `runExclusive` mutex, src/domain/backupGate.ts). Without that
 *  same gate here, `maybeAutoBackup`'s plain `db.select` reads (fired on app
 *  background, src/features/backup/repository.ts) could interleave with this
 *  transaction and snapshot a half-relabelled, MIXED-CURRENCY ledger into a
 *  backup. `relabelCurrency` below wraps this store's use in `runExclusive`
 *  for exactly that reason — never call `liveRelabelStore` directly. */
const liveRelabelStore: RelabelStore = {
  getCurrency,
  async listAccountRows() {
    const rows = await db
      .select({ id: accounts.id, currency: accounts.currency, amount: accounts.openingBalance })
      .from(accounts);
    return rows;
  },
  async listTransactionRows() {
    const rows = await db
      .select({ id: transactions.id, currency: transactions.currency, amount: transactions.amount })
      .from(transactions);
    return rows;
  },
  async listRecurringTemplateRows() {
    const rows = await db
      .select({ id: recurringSeries.id, template: recurringSeries.template })
      .from(recurringSeries);
    return rows.map((r) => ({ id: r.id, template: JSON.parse(r.template) as RecurrenceTemplate }));
  },
  async updateAccountRow(id, currency, amount) {
    await db
      .update(accounts)
      .set({ currency, openingBalance: amount })
      .where(eq(accounts.id, id));
  },
  async updateTransactionRow(id, currency, amount) {
    await db
      .update(transactions)
      .set({ currency, amount })
      .where(eq(transactions.id, id));
  },
  async updateRecurringTemplateRow(id, template) {
    await db
      .update(recurringSeries)
      .set({ template: JSON.stringify(template) })
      .where(eq(recurringSeries.id, id));
  },
  setCurrencySetting: setCurrency,
  bumpDataRevision,
  async runInTransaction(fn) {
    await expoDb.withTransactionAsync(fn);
  },
};

/**
 * Relabels every stored amount (accounts' openingBalance, transactions'
 * amount, recurring templates' amount) plus every `currency` column to
 * `newCode`, rescaling each amount only when the old/new exponents differ
 * (identity otherwise) — see rescaleMinor (src/domain/currencyRelabel.ts).
 * Updates the currency setting and bumps the data revision once (F3), so a
 * fresh backup fires on the next backgrounding. Safe to call on an empty
 * ledger too (Settings' "applies immediately" path) — it's just a no-op
 * rescale over zero rows. Rejects a `newCode` outside `SUPPORTED_CURRENCIES`
 * (guardrail #6) — see `relabelCurrencyWithStore`.
 *
 * Runs inside the SAME `runExclusive` mutex backup/restore use (H1/guardrail
 * #1): a relabel is a multi-row rewrite on the shared expo-sqlite connection,
 * so it must never interleave with a concurrent backup snapshot or restore —
 * either of which reads/writes the same tables outside any transaction this
 * function opens. Without this gate, `maybeAutoBackup` firing mid-relabel
 * (e.g. the app backgrounded right after the user confirms) could capture a
 * half-relabelled, mixed-currency ledger into a backup.
 */
export async function relabelCurrency(newCode: string): Promise<void> {
  await runExclusive(() => relabelCurrencyWithStore(liveRelabelStore, newCode));
}

/** Appearance preference; defaults to "system" (also the fallback for any
 * unrecognised stored value, so a future rollback / bad write never crashes). */
export async function getTheme(): Promise<ThemePreference> {
  const value = await getSetting(THEME_KEY);
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : 'system';
}

export async function setTheme(pref: ThemePreference): Promise<void> {
  await setSetting(THEME_KEY, pref);
}

/** Synchronous mirror of the biometric-lock setting. The background re-lock
 * handler (app/_layout.tsx) must decide synchronously — before the OS takes
 * the app-switcher snapshot — and a toggle flipped in Settings must take
 * effect on the very next backgrounding, not one foreground cycle later. */
let biometricLockCache: boolean | null = null;

/** Last-read/last-written biometric-lock value; null until either has run. */
export function getBiometricLockCached(): boolean | null {
  return biometricLockCache;
}

/** Whether biometric unlock is required on launch; opt-in — defaults OFF for
 * anyone who hasn't set a preference, so a fresh install never prompts Face
 * ID before the user has asked for a lock. With the account gone this is the
 * app's only gate (CLAUDE.md guardrail #2) once the user turns it on. */
export async function getBiometricLock(): Promise<boolean> {
  const v = await getSetting(BIOMETRIC_LOCK_KEY);
  const on = resolveBiometricLock(v);
  biometricLockCache = on;
  return on;
}

export async function setBiometricLock(on: boolean): Promise<void> {
  // Cache first so the new value is visible synchronously even while the
  // DB write is still in flight (e.g. toggle then immediately background).
  biometricLockCache = on;
  await setSetting(BIOMETRIC_LOCK_KEY, on ? '1' : '0');
}

/** Whether the first-run welcome carousel (app/welcome.tsx, build 39) has
 * been completed (or skipped) — same flag as the build-38 guided tutorial it
 * replaced. Opt-out by completion, not opt-in — default OFF (i.e. "not
 * complete") when unset, so a fresh install with no accounts yet shows the
 * carousel; any stored value other than the literal '1' (including a corrupt
 * one) also resolves to false, same fail-open-to-"not complete" shape as
 * resolveBiometricLock. Device-local (see DEVICE_LOCAL_SETTINGS_KEYS in
 * src/domain/backupPolicy.ts) — a backup restore must never carry this flag
 * onto another device/state. */
export async function getOnboardingComplete(): Promise<boolean> {
  return resolveOnboardingComplete(await getSetting(ONBOARDING_COMPLETE_KEY));
}

export async function setOnboardingComplete(complete: boolean): Promise<void> {
  await setSetting(ONBOARDING_COMPLETE_KEY, complete ? '1' : '0');
}

/** Selected assistant-avatar look id (e.g. "mint"); null → caller's default. */
export async function getAvatarLook(): Promise<string | null> {
  return getSetting(AVATAR_LOOK_KEY);
}

export async function setAvatarLook(id: string): Promise<void> {
  await setSetting(AVATAR_LOOK_KEY, id);
}

/** Selected avatar kind id (e.g. "blob"); null → caller's default (blob). */
export async function getAvatarKind(): Promise<string | null> {
  return getSetting(AVATAR_KIND_KEY);
}

export async function setAvatarKind(id: string): Promise<void> {
  await setSetting(AVATAR_KIND_KEY, id);
}

/** All preferences as a plain map — included in the iCloud backup snapshot. */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Apply a map of preferences from a backup restore. Upserts each key EXCEPT
 * device-local settings (`DEVICE_LOCAL_SETTINGS_KEYS` — biometric_lock,
 * backup_auto_enabled, theme), which are filtered out via
 * `settingsForRestore` so a restored backup — including an older one made
 * before this fix, which may still contain `biometric_lock='1'` — can never
 * silently re-enable the device's biometric lock (or flip its theme/auto-
 * backup pref) without going through the enable-gate's auth check. Only used
 * by backup restore (both the JSON `applyBackup` and the sqlite
 * `applyBackupUnlocked` paths funnel their settings map through here).
 */
export async function applySettings(
  values: Record<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(settingsForRestore(values))) {
    await setSetting(key, value);
  }
}
