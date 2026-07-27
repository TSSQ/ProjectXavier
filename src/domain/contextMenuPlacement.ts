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
