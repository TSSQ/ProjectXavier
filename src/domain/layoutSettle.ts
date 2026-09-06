/**
 * Settles a measured layout height into the whole-point value ScreenHeader
 * keys its glass on (glass-chrome-adoption-spec §4 D2). expo-glass-effect
 * applies its effect only on a GlassView's first layout, so a changed height
 * must mount a fresh instance — but sub-point jitter within the same point
 * (101.2 then 101.7) must NOT, or the material would remount for nothing.
 * Rounding up makes equal-looking heights key-equal; React's own state
 * bail-out (Object.is) then skips the update.
 */
export function settleMeasuredHeight(raw: number): number {
  return Math.ceil(raw);
}
