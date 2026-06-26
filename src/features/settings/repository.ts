/**
 * App-level preferences (key/value), persisted via Drizzle / parameterised SQL.
 *
 * Currency lives here rather than on each account: the app uses a single display
 * currency (no per-account currency, no FX). Accounts and transactions still
 * carry a `currency` column, but it always mirrors this setting.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema';

export const DEFAULT_CURRENCY = 'SGD';
const CURRENCY_KEY = 'currency';
const AVATAR_LOOK_KEY = 'avatar_look';
const AVATAR_KIND_KEY = 'avatar_kind';
const PROGRESSION_BASELINE_KEY = 'progression_baseline';
const PROGRESSION_HIGHWATER_KEY = 'progression_highwater';

/** ISO 4217 display currencies, roughly ordered by global usage. */
export const SUPPORTED_CURRENCIES = [
  // Asia-Pacific
  'SGD', 'AUD', 'HKD', 'JPY', 'CNY', 'KRW', 'TWD', 'MYR', 'IDR', 'THB',
  'PHP', 'VND', 'INR', 'PKR', 'BDT', 'LKR', 'NZD',
  // Americas
  'USD', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN',
  // Europe
  'EUR', 'GBP', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'TRY', 'RUB', 'UAH',
  // Middle-East & Africa
  'AED', 'SAR', 'ILS', 'EGP', 'NGN', 'KES', 'ZAR', 'GHS',
] as const;

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

export async function getCurrency(): Promise<string> {
  return (await getSetting(CURRENCY_KEY)) ?? DEFAULT_CURRENCY;
}

export async function setCurrency(code: string): Promise<void> {
  await setSetting(CURRENCY_KEY, code);
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

/**
 * Avatar-evolution progression (see src/domain/evolution.ts). Baseline = net
 * worth (minor units) captured the first time progression runs with an account
 * present. High-water = the maximum growth-over-baseline ever reached; stage
 * derives from it and never decreases. Both are plain settings and ride along
 * in encrypted backups.
 */
export async function getProgressionBaseline(): Promise<number | null> {
  const v = await getSetting(PROGRESSION_BASELINE_KEY);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function setProgressionBaseline(minor: number): Promise<void> {
  await setSetting(PROGRESSION_BASELINE_KEY, String(Math.round(minor)));
}

/** Highest growth-over-baseline ever observed (minor units). Defaults to 0. */
export async function getProgressionHighWater(): Promise<number> {
  const v = await getSetting(PROGRESSION_HIGHWATER_KEY);
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function setProgressionHighWater(minor: number): Promise<void> {
  await setSetting(PROGRESSION_HIGHWATER_KEY, String(Math.round(minor)));
}

/** All preferences as a plain map — used to include them in an encrypted backup. */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Apply a map of preferences (e.g. on restore). Upserts each key. */
export async function applySettings(
  values: Record<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await setSetting(key, value);
  }
}
