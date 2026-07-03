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
const THEME_KEY = 'theme';

export type ThemePreference = 'system' | 'light' | 'dark';
const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

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

/** Apply a map of preferences (e.g. on restore). Upserts each key. */
export async function applySettings(
  values: Record<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await setSetting(key, value);
  }
}
