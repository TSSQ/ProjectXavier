/**
 * ISO 4217 minor-unit exponents — the pure fact table behind currency-aware
 * money math (see money.ts). Most currencies use 2 decimal places (100 minor
 * units per major unit), but a handful use 0 (e.g. JPY) or 3 (e.g. BHD).
 *
 * Covers every code in `SUPPORTED_CURRENCIES` (src/features/settings/
 * repository.ts) — none of those are 3-decimal today, but the 3-decimal set
 * is included so a future addition (BHD/KWD/OMR/TND) is correct without
 * touching this table again. Never throws: an unrecognised/legacy code (e.g.
 * from a restored backup written by a future build) defaults to 2 — the
 * common case — rather than crashing (review F1 / M7 edge case).
 */

/**
 * ISO 4217 display currencies, roughly ordered by global usage. Lives here
 * (rather than only in src/features/settings/repository.ts, which re-exports
 * it for callers) so it's framework-free and can be asserted against
 * `currencyExponent` in the plain-Node BDD suite — settings/repository.ts
 * itself depends on expo-sqlite and isn't Node-testable.
 */
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

/** 0-decimal currencies (100 = the base unit, not a fraction of it). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP']);

/** 3-decimal currencies. None are in SUPPORTED_CURRENCIES yet — kept ready
 *  for a future addition. */
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'TND']);

/** The number of minor-unit digits for `code` (case-insensitive): 0, 2, or 3.
 *  Defaults to 2 for anything not in either set above. */
export function currencyExponent(code: string): 0 | 2 | 3 {
  const c = (code ?? '').trim().toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}
