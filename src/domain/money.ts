/**
 * Money helpers. All amounts are integer minor units (cents) internally.
 */

/** Convert a major-unit amount (e.g. 12.34 dollars) to minor units (1234). */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** Convert minor units (1234) back to a major-unit number (12.34). */
export function toMajorUnits(minor: number): number {
  return minor / 100;
}

/** Locale-aware currency formatting for display. */
export function formatMoney(
  minor: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(toMajorUnits(minor));
}
