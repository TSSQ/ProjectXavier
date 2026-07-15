/**
 * Pure paging math for the welcome carousel (app/welcome.tsx). Extracted so
 * the one part of `Animated.ScrollView horizontal pagingEnabled` paging that
 * doesn't require a device/simulator — turning a raw scroll offset into a
 * page index, and deciding whether an overscroll counts as "swiped past the
 * end" — is covered by the plain-Node BDD suite.
 *
 * Build 39 device bug: `width` can legitimately be 0 for a frame before the
 * ScrollView's first layout pass. `Math.round(x / 0)` is `Infinity` (or
 * `NaN` for `x === 0`), which `Math.min`/`Math.max` clamp to the last page —
 * silently landing on the last card, and (worse) satisfying the overscroll-
 * finish threshold and firing `finish()` before the user ever swiped.
 * `indexFromOffset` and `shouldFinishFromOverscroll` both guard `width <= 0`
 * so neither can fire on a not-yet-laid-out ScrollView.
 */

/** Which page a raw horizontal `contentOffset.x` corresponds to, clamped to
 *  `[0, count - 1]`. Returns 0 for a non-positive `width` (not yet laid out)
 *  or `count`, rather than propagating `NaN`/`Infinity` from a division by
 *  zero. */
export function indexFromOffset(x: number, width: number, count: number): number {
  if (!(width > 0) || count <= 0) return 0;
  const idx = Math.round(x / width);
  return Math.min(count - 1, Math.max(0, idx));
}

/** Whether a scroll-end offset `x` represents a deliberate overscroll past
 *  the last card's resting offset (`lastIndex * width`) by more than
 *  `thresholdPx` — the carousel's "swipe past the end == Get Started"
 *  gesture. Always false while `width` isn't yet a real, positive layout
 *  measurement, so a pre-layout frame (width === 0) can never spuriously
 *  finish onboarding. */
export function shouldFinishFromOverscroll(
  x: number,
  width: number,
  lastIndex: number,
  thresholdPx: number
): boolean {
  if (!(width > 0) || lastIndex < 0) return false;
  const maxOffset = lastIndex * width;
  return x > maxOffset + thresholdPx;
}
