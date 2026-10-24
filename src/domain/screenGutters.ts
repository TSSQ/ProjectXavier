/**
 * Side gutters that honour the horizontal safe area.
 *
 * On iPhone Duo (and on any iPhone in landscape) iOS reserves space along the
 * LEFT or RIGHT edge for things that used to live only at the top and bottom:
 * the tab bar becomes a vertical rail, the status bar becomes a side column
 * with the clock and Dynamic Island, and in Split View the rail sits on the
 * outer edge of whichever half the app is in. react-native-safe-area-context
 * reports all of that as `insets.left` / `insets.right`, and Apple is explicit
 * that the two sides are usually NOT equal, so a layout must never derive one
 * side from the other (`insets.left * 2` is the documented anti-pattern).
 *
 * Until the Duo work, every screen padded `insets.top` and `insets.bottom`
 * and hard-coded its horizontal padding, which put the composer, the FAB and
 * the Skip button under the rail (docs/native/expo-sdk-58-upgrade.md, "iPhone
 * Duo"). These two helpers are the one place that arithmetic lives.
 *
 * Framework-free so the plain-Node BDD suite covers it; the screens feed it
 * `useSafeAreaInsets()`.
 */

/** The two horizontal insets, as `useSafeAreaInsets()` reports them. */
export interface HorizontalInsets {
  left: number;
  right: number;
}

/** A reported inset, made safe to add: a missing, NaN or negative value
 *  contributes nothing rather than pulling content past the edge. */
function safeInset(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Horizontal padding for a screen's content: the design's own gutter (`base`,
 * e.g. the 24pt screen padding or `useScaledType().screenPadding`) plus
 * whatever the system reserves on THAT side. Spread it into a style after any
 * `padding`/`paddingHorizontal` shorthand so it wins:
 *
 *   contentContainerStyle={{ padding: 24, ...sideGutters(insets, 24) }}
 */
export function sideGutters(
  insets: HorizontalInsets,
  base: number
): { paddingLeft: number; paddingRight: number } {
  const gutter = safeInset(base);
  return {
    paddingLeft: gutter + safeInset(insets.left),
    paddingRight: gutter + safeInset(insets.right),
  };
}

/**
 * Offset for a control pinned to one screen edge (the FAB's `right`, the
 * onboarding Skip button, the A–Z rail): its designed distance from the edge
 * plus that edge's inset, so it sits beside the rail instead of under it.
 */
export function edgeOffset(inset: number | undefined, base: number): number {
  return safeInset(base) + safeInset(inset);
}
