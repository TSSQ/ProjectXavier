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

/** A small, sensible set of supported display currencies. */
export const SUPPORTED_CURRENCIES = [
  'SGD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'MYR',
  'INR',
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
