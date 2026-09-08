/**
 * Glass mount gate — "may a Glass mount yet?" (style guide R9: "No Glass
 * under a layout animation. A Glass whose first layout lands during an
 * ancestor's Reanimated animation never renders.") `expo-glass-effect`'s
 * GlassView applies its native effect exactly once, on its own first
 * `layoutSubviews`, and loses it for good if that layout lands mid
 * animation — so a Glass nested under an `entering` animation must defer
 * its OWN first mount until the ancestor has settled. `BottomSheet.tsx`
 * keys its shell's Glass on exactly this; QA round 1 found the sheet's
 * close `IconButton` sitting in the same animated subtree, unguarded.
 *
 * Extracted so the DECISION itself has direct scenario coverage, including
 * the mid-animation case, rather than only its call sites (QA round 2
 * MAJOR 2): a source scan can confirm a call site passes `glass={showGlass}`
 * instead of a literal, but it can't confirm `showGlass` itself is computed
 * correctly — that's what `glass-mount-gate.feature` pins.
 *
 * `entered` is OPTIONAL (default true) because this predicate covers TWO
 * related but distinct gates, not one (QA round 3): `BottomSheet` sits
 * under a Reanimated `entering` animation and must wait for BOTH `entered`
 * and `measured`; `ScreenHeader`, `Composer`'s field and `MenuPanel` mount
 * with the screen (no animated ancestor — Glass.tsx's header documents this
 * as the OTHER safe case) and only ever needed the `measured` half of this
 * same check. Before this, those three each re-derived
 * `tier === 'native' && measured !== null` inline — this predicate's own
 * stated purpose ("the entering-animation case") held for one call site out
 * of four. Omitting `entered` (rather than passing `true` at every one of
 * those three call sites) says plainly, at the call site, "no entering
 * animation to wait for here".
 */
import { GlassTier } from '../theme/glassTokens';

export interface GlassMountSignals {
  tier: GlassTier;
  /** Whether the ancestor's Reanimated `entering` animation has finished
   *  (`SlideInDown.withCallback` reporting `finished`, in BottomSheet's
   *  case). Omit when there is no such ancestor at all (ScreenHeader,
   *  Composer's field, MenuPanel) — defaults to `true`. */
  entered?: boolean;
  /** Whatever "has this content been measured yet" value the caller
   *  tracks — a full `{width, height}` (BottomSheet, MenuPanel) or a single
   *  settled height number (ScreenHeader, Composer). Only nullity matters:
   *  a childless Glass sized off this has nothing to size itself against
   *  before its first `onLayout` fires. */
  measured: unknown;
}

/**
 * Whether a Glass gated on these signals may mount now. `false` on the
 * opaque tier too, even once settled and measured: `Glass.tsx` never mounts
 * a real `GlassView` there anyway (it falls back to a flat `View`
 * regardless), so nothing downstream needs a tier-conditional caller — the
 * gate is simply "no" for the whole opaque tier.
 */
export function mayMountGlass({ tier, entered = true, measured }: GlassMountSignals): boolean {
  // `!= null` (loose), not `!== null` (QA round 4): `measured` is `unknown`,
  // which accepts `undefined` too, and `undefined !== null` is `true` — a
  // ref (`.current` starts `undefined`, never `null`) or an optional-state
  // caller would type-check and read as "mounted" while still unmeasured,
  // the exact R9 bug this predicate exists to prevent. Not reachable by
  // today's four callers (all `useState<T | null>(null)`), but the widened
  // `measured: unknown` is precisely what makes a fifth caller shaped that
  // way plausible.
  return tier === 'native' && entered && measured != null;
}
