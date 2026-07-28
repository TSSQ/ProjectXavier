/**
 * Pure placement arithmetic for `src/components/ui/ContextMenu.tsx` (the
 * long-press row menu on the transactions list / account detail screen).
 *
 * Kept framework-free (no react-native import) so it's covered by the plain-
 * Node BDD suite — the RN component is a thin wrapper that measures/derives
 * `menuWidth`/`menuHeight` from `useScaledType()` and passes them in here.
 *
 * Bug this fixes: the component used to compute `menuHeight` from a
 * hard-coded `ITEM_H` that ignored Dynamic Type, so at large font scales the
 * *actual* rendered menu was taller than the height used to decide
 * above-vs-below placement and the bottom clamp — the panel could float
 * between two rows or run off the bottom of the screen. Callers must now
 * pass the real (scaled) menu height/width so the clamp below is accurate.
 */

const EDGE_MARGIN = 12;
/** Horizontal offset so the menu appears roughly centered over the touch
 *  point rather than flush with its left edge. */
const TOUCH_X_OFFSET = 24;
/** Gap between the touch point and the menu when placed above it. */
const GAP_ABOVE = 8;
/** Gap between the touch point and the menu when placed below it. */
const GAP_BELOW = 16;
/** Touches this close to the top flip the menu below instead of above, so it
 *  doesn't collide with the status bar / nav bar. */
const TOP_FLIP_THRESHOLD = 60;
/** Extra bottom clearance (tab bar / home indicator) beyond EDGE_MARGIN. */
const BOTTOM_CLEARANCE = 40;

/** Rough average glyph advance as a fraction of font size, for the menu's
 *  medium-weight system font. Only used to ESTIMATE how wide the panel will
 *  render so placement can clamp against a realistic width — the panel itself
 *  is laid out by flexbox and never uses this number, so a small error costs a
 *  few points of horizontal position, never a clipped label. */
const AVG_GLYPH_RATIO = 0.62;

export interface MenuWidthInput {
  /** Every item label in the menu — the widest one determines the panel. */
  labels: string[];
  fontSize: number;
  iconSize: number;
  /** Horizontal padding inside a row, one side. */
  itemPadH: number;
  /** Gap between the icon and the label. */
  itemGap: number;
  /** Row's horizontal margin inside the panel, one side. */
  itemMarginH: number;
  minWidth: number;
  maxWidth: number;
}

/**
 * Estimate the rendered panel width so `computeMenuPlacement` can clamp
 * against something close to reality.
 *
 * Before this existed the component passed its `maxWidth` (260) as the
 * placement width. That made the right-edge clamp act as if every menu were
 * 260pt wide, so a compact one-item menu was pushed well left of the touch
 * point for no reason. Estimating is not exact — but being ~10pt off beats
 * being 160pt off, and the panel's real flex layout is unaffected either way.
 */
export function estimateMenuWidth({
  labels,
  fontSize,
  iconSize,
  itemPadH,
  itemGap,
  itemMarginH,
  minWidth,
  maxWidth,
}: MenuWidthInput): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  const textW = Math.ceil(longest * fontSize * AVG_GLYPH_RATIO);
  const contentW = itemMarginH * 2 + itemPadH * 2 + iconSize + itemGap + textW;
  return Math.min(Math.max(contentW, minWidth), maxWidth);
}

export interface MenuPlacementInput {
  /** pageX from the long-press GestureResponderEvent. */
  touchX: number;
  /** pageY from the long-press GestureResponderEvent. */
  touchY: number;
  /** Actual (scaled) menu width, e.g. the ContextMenu's maxWidth. */
  menuWidth: number;
  /** Actual (scaled) menu height, computed from the real font size — not a
   *  hard-coded row height. */
  menuHeight: number;
  screenWidth: number;
  screenHeight: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
}

/**
 * Prefers placing the menu above the touch point; flips below when there
 * isn't room near the top of the screen. Clamps both axes to the screen
 * edges (with a margin) so the menu can never render partially off-screen —
 * including when `menuHeight` is tall (large Dynamic Type + several items).
 */
export function computeMenuPlacement({
  touchX,
  touchY,
  menuWidth,
  menuHeight,
  screenWidth,
  screenHeight,
}: MenuPlacementInput): MenuPlacement {
  const above = touchY - menuHeight - GAP_ABOVE;
  const top = above > TOP_FLIP_THRESHOLD ? above : touchY + GAP_BELOW;

  // Floor at EDGE_MARGIN so a menu taller than the available space still
  // lands on-screen (top never goes negative) instead of only capping the
  // upper bound.
  const maxTop = Math.max(screenHeight - menuHeight - BOTTOM_CLEARANCE, EDGE_MARGIN);
  const clampedTop = Math.min(top, maxTop);

  const maxLeft = Math.max(screenWidth - menuWidth - EDGE_MARGIN, EDGE_MARGIN);
  const left = Math.min(Math.max(touchX - TOUCH_X_OFFSET, EDGE_MARGIN), maxLeft);

  return { left, top: clampedTop };
}
