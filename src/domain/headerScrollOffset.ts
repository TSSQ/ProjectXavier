/**
 * Pure "how far should the sticky ScreenHeader be slid up" rule behind the
 * hide-on-scroll-down / reveal-on-scroll-up behaviour on Dashboard and
 * Transactions (docs/design/transparent-hiding-header-spec.md). Framework-
 * free — no react-native/react-native-reanimated import — so it's covered by
 * the plain-Node BDD suite.
 *
 * Called from the JS thread, not a UI-thread worklet: device testing found
 * `useAnimatedScrollHandler`'s native event registration does not fire at
 * all in this build (confirmed on both `Animated.ScrollView` and a
 * `createAnimatedComponent`-wrapped `SectionList`, with a minimal
 * `runOnJS`-only handler, under a confirmed real scroll — see the spec's
 * "Why onScroll is a plain callback" and `ScreenHeader.tsx`'s
 * `useScreenHeaderScroll`), so the caller uses an ordinary `onScroll`
 * callback instead and writes this function's result straight into a
 * shared value. No `'worklet'` directive needed here as a result — this
 * function never runs on the UI thread — but it stays exactly as
 * framework-free as it was when it did, so the domain rule and its
 * `.feature` coverage are unaffected by which thread ends up calling it.
 *
 * `offset` is the header's own slide distance: 0 = fully shown (resting),
 * `headerHeight` = fully hidden (slid entirely past its own height, so
 * nothing of it is left on screen). The caller drives an `Animated.View`'s
 * `translateY: -offset` from this.
 */

/** Below this many points of scroll from the top, the header is forced fully
 *  shown regardless of direction. This absorbs iOS's elastic top overscroll
 *  (a fast upward fling can still report a few points of "scroll" as it
 *  settles) and means a list barely nudged never starts hiding chrome the
 *  user hasn't actually scrolled past. */
const NEAR_TOP_THRESHOLD = 24;

export interface HeaderOffsetInput {
  /** The header's current slide distance (0 shown .. headerHeight hidden). */
  offset: number;
  /** The scroll position on the PREVIOUS frame/event. */
  previousY: number;
  /** The scroll position on THIS frame/event. */
  y: number;
  /** The header's own measured height — offset's upper clamp. */
  headerHeight: number;
  /** True while something the header owns must stay reachable regardless of
   *  scroll — Transactions' open, focused search field. Sliding a focused
   *  text field off screen mid-typing is a bug, not a nicety, so this
   *  bypasses scroll entirely and always returns fully shown. Default false
   *  (Dashboard has nothing that needs it). */
  locked?: boolean;
}

/**
 * The new offset for one scroll event. Scrolling down (y increasing) grows
 * the offset — hides, clamped at `headerHeight`; scrolling up shrinks it —
 * reveals, clamped at 0. Near the top, or at any negative `y` (the
 * rubber-band bounce past the top — always `<= NEAR_TOP_THRESHOLD`, which is
 * positive), the header is forced fully shown. A `locked` caller (the open
 * search field) bypasses scroll entirely and always returns 0.
 */
export function nextHeaderOffset({
  offset,
  previousY,
  y,
  headerHeight,
  locked = false,
}: HeaderOffsetInput): number {
  if (locked) return 0;
  if (y <= NEAR_TOP_THRESHOLD) return 0;
  const next = offset + (y - previousY);
  if (next <= 0) return 0;
  if (next >= headerHeight) return headerHeight;
  return next;
}
