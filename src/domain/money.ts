/**
 * Money helpers. All amounts are integer minor units internally — how many
 * minor units make up one major unit depends on the currency's ISO 4217
 * exponent (currencyExponent, ./currency.ts): 100 for most currencies (cents),
 * 1 for a 0-decimal currency like JPY, 1000 for a 3-decimal one like BHD.
 *
 * The app is single-currency (see src/features/settings/repository.ts), so
 * every caller either passes the current `getCurrency()` value or a row's own
 * `currency` column — both always resolve to the same exponent day-to-day,
 * but threading it explicitly here means a restored/relabelled ledger in a
 * different currency still scales correctly. `currency` defaults to 'USD'
 * (2-decimal) so existing single-argument call sites keep working.
 */
import { currencyExponent } from './currency';

/** Convert a major-unit amount (e.g. 12.34 dollars, or 1000 yen) to minor
 *  units (1234, or 1000 for JPY since its exponent is 0). */
export function toMinorUnits(major: number, currency = 'USD'): number {
  return Math.round(major * 10 ** currencyExponent(currency));
}

/** Convert minor units back to a major-unit number, per `currency`'s exponent. */
export function toMajorUnits(minor: number, currency = 'USD'): number {
  return minor / 10 ** currencyExponent(currency);
}

/** Locale-aware currency formatting for display. Falls back to a plain
 *  fixed-point string (still scaled by the right exponent) if `currency` is
 *  malformed (not a well-formed 3-letter code) — e.g. a corrupted/legacy
 *  value surviving in a restored backup — rather than throwing. */
export function formatMoney(
  minor: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  const major = toMajorUnits(minor, currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(major);
  } catch {
    return major.toFixed(currencyExponent(currency));
  }
}
