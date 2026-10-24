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
 * Width left for content between the two gutters: the window width minus the
 * system's reservation on each side minus the design's own `gutter` on each
 * side (so `2 * gutter`). Never negative; a missing, NaN or negative inset
 * contributes nothing and a NaN window width yields 0.
 */
export function contentWidthFor(
  windowWidth: number,
  insets: HorizontalInsets,
  gutter: number
): number {
  const width = windowWidth - safeInset(insets.left) - safeInset(insets.right) - 2 * safeInset(gutter);
  return Number.isFinite(width) ? Math.max(0, width) : 0;
}

/**
 * Offset for a control pinned to one screen edge (the FAB's `right`, the
 * onboarding Skip button, the A–Z rail): its designed distance from the edge
 * plus that edge's inset, so it sits beside the rail instead of under it.
 */
export function edgeOffset(inset: number | undefined, base: number): number {
  return safeInset(base) + safeInset(inset);
}

/** iOS's standard bar height: the room a screen's own top bar (back chevron,
 *  search) keeps when the system reserves nothing above it. */
export const TOP_GUTTER_FLOOR = 44;

/**
 * Top padding for a screen that draws its own top bar under the status bar.
 * `insetTop + base` on any phone (59 + 12 on a Dynamic Island phone, 47 + 12
 * on a notch), but never less than a bar's worth plus `base`: on iPhone Duo's
 * rail poses the status bar moves to the side and `insets.top` is 0, which
 * used to leave the chevron and title 12pt from the top edge on some screens
 * while others hard-coded 56. One rule for all of them.
 */
export function topGutter(insetTop: number | undefined, base = 12): number {
  return Math.max(safeInset(insetTop), TOP_GUTTER_FLOOR) + safeInset(base);
}
