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
import { resolveBiometricLock } from '../../domain/biometricLock';
import { resolveOnboardingComplete } from '../../domain/onboardingComplete';
import { settingsForRestore } from '../../domain/backupPolicy';
import { ByokProvider } from '../../domain/parseRouter';

export const DEFAULT_CURRENCY = 'SGD';
const CURRENCY_KEY = 'currency';
const AVATAR_LOOK_KEY = 'avatar_look';
const AVATAR_KIND_KEY = 'avatar_kind';
const THEME_KEY = 'theme';
const BIOMETRIC_LOCK_KEY = 'biometric_lock';
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

// ─── BYOK (bring-your-own-key) config — non-secret only; the key itself
// lives in the Keychain (src/features/ai/byokKey.ts), never here. ──────────
const BYOK_ENABLED_KEY = 'byok_enabled';
const BYOK_PROVIDER_KEY = 'byok_provider';
const BYOK_MODEL_OPENAI_KEY = 'byok_model_openai';
const BYOK_MODEL_ANTHROPIC_KEY = 'byok_model_anthropic';

/** Default model per provider — editable in Settings. `claude-3-5-haiku-latest`
 *  (not the bare "claude-3-5-haiku") is the id the eval harness already
 *  proved works against the real Anthropic API
 *  (evals/engines/run_node.mjs's DEFAULT_ANTHROPIC_MODEL). */
export const DEFAULT_BYOK_MODEL: Record<ByokProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

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

/** Whether BYOK is toggled on in Settings. Device-local (see
 * DEVICE_LOCAL_SETTINGS_KEYS) — a restore must never silently turn on
 * another device's cloud-parse preference. Note this is the raw toggle, not
 * the *effective* enabled state: src/domain/parseRouter.ts's
 * resolveByokEnabled also requires a key to actually be saved
 * (src/features/ai/byokKey.ts). */
export async function getByokEnabled(): Promise<boolean> {
  return (await getSetting(BYOK_ENABLED_KEY)) === '1';
}

export async function setByokEnabled(on: boolean): Promise<void> {
  await setSetting(BYOK_ENABLED_KEY, on ? '1' : '0');
}

/** The chosen BYOK provider — defaults to "openai" (same default the
 * Settings screen shows before the user has ever tapped the provider
 * picker), so turning the enable toggle on alone is enough to route to a
 * provider once a key is saved; unrecognised/corrupt stored values also fall
 * back to this default rather than returning null. */
export async function getByokProvider(): Promise<ByokProvider> {
  const v = await getSetting(BYOK_PROVIDER_KEY);
  return v === 'openai' || v === 'anthropic' ? v : 'openai';
}

export async function setByokProvider(provider: ByokProvider): Promise<void> {
  await setSetting(BYOK_PROVIDER_KEY, provider);
}

const BYOK_MODEL_KEY: Record<ByokProvider, string> = {
  openai: BYOK_MODEL_OPENAI_KEY,
  anthropic: BYOK_MODEL_ANTHROPIC_KEY,
};

/** The model id to use for `provider` — falls back to DEFAULT_BYOK_MODEL
 * when the user hasn't overridden it. */
export async function getByokModel(provider: ByokProvider): Promise<string> {
  const v = await getSetting(BYOK_MODEL_KEY[provider]);
  return v && v.trim().length > 0 ? v : DEFAULT_BYOK_MODEL[provider];
}

export async function setByokModel(provider: ByokProvider, model: string): Promise<void> {
  await setSetting(BYOK_MODEL_KEY[provider], model);
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
