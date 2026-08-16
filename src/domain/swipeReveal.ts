/**
 * Pure gesture-arithmetic behind `src/components/ui/SwipeableRow.tsx` (the
 * swipe-left `Copy | Delete` reveal on a transaction row — see
 * docs/design/swipe-row-actions-spec.md, §4.1). Kept framework-free (no
 * react/react-native import) so it's covered by the plain-Node BDD suite —
 * the RN component is a thin `PanResponder` + Reanimated wrapper that reads
 * gesture deltas/velocity and the scaled font size and passes them in here.
 * Pure geometry here, RN wiring in the component — the split that keeps
 * this testable in the plain-Node suite.
 *
 * Direction is intentionally NOT baked in: every function takes/returns a
 * *signed* translate where negative = revealed (open) and 0 = closed. The
 * component chooses what sign a physical left-vs-right drag maps to, so a
 * future RTL mode is one `I18nManager.isRTL` read in the component, not a
 * rewrite of this module. Today the product is LTR-only (see spec §2.6,
 * §8.5), so the component hardcodes swipe-LEFT-to-reveal — negative here.
 */

/** Below this many points of horizontal movement, a drag is ambiguous (could
 *  still be a tap or the start of a vertical scroll) — don't claim yet. */
const MIN_CLAIM_DX = 8;
/** A drag must be at least this many times more horizontal than vertical to
 *  count as swipe intent rather than list-scroll intent. */
const HORIZONTAL_RATIO = 2;

/** How far past the resting-open position (`-actionsWidth`) a drag may
 *  rubber-band before hard-stopping. 1.15 gives a soft, springy overshoot
 *  without ever letting the strip's content be dragged fully into view plus
 *  empty space beyond it. */
const OVERSHOOT_FACTOR = 1.15;

/** Position past which a released drag snaps open rather than closed, as a
 *  fraction of `actionsWidth`. */
const SNAP_POSITION_FRACTION = 0.5;
/** |velocity| (points/ms — the same unit as PanResponder's `gestureState.vx`)
 *  past which a release is treated as a deliberate flick and snaps by
 *  direction alone, regardless of how far the drag had travelled. */
const FLICK_VELOCITY = 0.5;

export interface HorizontalDragInput {
  /** Cumulative horizontal movement since the gesture started. */
  dx: number;
  /** Cumulative vertical movement since the gesture started. */
  dy: number;
}

/**
 * Should a move be claimed as a horizontal swipe (vs. left for the list to
 * scroll, or for a tap/long-press to resolve normally)? True only once the
 * drag is unambiguously horizontal: past an 8pt floor (so a shaky tap or the
 * very start of any gesture doesn't immediately claim) AND at least 2:1
 * horizontal-to-vertical (so a diagonal drag resolves as a scroll, not a
 * swipe). Sign-agnostic — a right-swipe on an open row (closing it) claims
 * exactly the same way as a left-swipe on a closed one.
 */
export function shouldClaimHorizontal({ dx, dy }: HorizontalDragInput): boolean {
  return Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO && Math.abs(dx) > MIN_CLAIM_DX;
}

/**
 * Clamp a raw (signed) translate to the row's valid range. `rawDx` is the
 * gesture's cumulative dx ADDED to wherever the row started (0 if it began
 * closed, `-actionsWidth` if it began open) — the component's job, not this
 * function's.
 *
 * - A positive result would mean dragging the row past fully-closed (e.g. a
 *   right-swipe starting from closed) — clamped to 0, no rubber-band on that
 *   side; there's nothing to reveal in that direction.
 * - A very negative result (dragging well past fully-open) rubber-bands to
 *   `-actionsWidth * 1.15` and stops — overshoot is allowed (so the drag
 *   doesn't feel like it hit a wall) but never past that point.
 * - Anything in between passes through unchanged (identity) — the row
 *   tracks the finger 1:1 while within its normal travel.
 */
export function clampTranslate(rawDx: number, actionsWidth: number): number {
  const min = -actionsWidth * OVERSHOOT_FACTOR;
  return Math.min(Math.max(rawDx, min), 0);
}

export interface SnapInput {
  /** The row's current (signed, already-clamped) translate at release. */
  translateX: number;
  /** Release velocity in the x direction — same sign convention as
   *  translateX (negative = moving further open). Same unit as
   *  PanResponder's `gestureState.vx`. */
  velocityX: number;
  actionsWidth: number;
}

/**
 * Decide whether a released drag should settle open or closed. Velocity
 * wins when the release is a deliberate flick (past `FLICK_VELOCITY`),
 * regardless of how far the row had actually travelled — this is what lets
 * a fast flick open a row the user barely dragged, and a fast reverse flick
 * close a row that was already mostly open. Otherwise it's decided by
 * position: past halfway open, short of halfway closed.
 */
export function resolveSnap({ translateX, velocityX, actionsWidth }: SnapInput): 'open' | 'closed' {
  if (velocityX <= -FLICK_VELOCITY) return 'open';
  if (velocityX >= FLICK_VELOCITY) return 'closed';
  return Math.abs(translateX) > actionsWidth * SNAP_POSITION_FRACTION ? 'open' : 'closed';
}

export interface ActionsWidthInput {
  /** Scaled font size the action labels render at (e.g.
   *  `useScaledType().role.caption`) — never a constant, so the strip grows
   *  with Dynamic Type instead of clipping "Delete" at large scales. */
  fontSize: number;
  /** Icon size — fixed, not Dynamic-Type-scaled (the label beside it
   *  makes for its own icons), but still a floor on button width so a tiny
   *  font at a huge icon size can't collapse below the icon itself. */
  iconSize: number;
  /** Horizontal padding inside a button, one side. */
  padH: number;
  /** Gap between adjacent buttons in the strip. */
  gap: number;
  /** Floor so a short label ("Copy") doesn't produce a cramped button. */
  minButtonWidth: number;
  /** Number of actions in the strip (e.g. 2 for Copy + Delete). Pass 1 to
   *  get a single button's own width (no gaps) — e.g. for a button's
   *  `minWidth` style, computed from this same formula so the per-button
   *  width and the strip's total width can never drift apart. */
  count: number;
}

/** Rough average glyph advance as a fraction of font size — same analytical
 *  approach: estimate rather than measure, so layout stays synchronous. Tuned for the
 *  longer of the two fixed action labels ("Delete", 6 glyphs): unlike
 *  `estimateMenuWidth`, this function doesn't take label strings, because
 *  the strip only ever renders this app's two fixed actions — Copy and
 *  Delete both render at the SAME (uniform) button width, sized for
 *  whichever is longer, matching the flush, evenly-sized strip look of the
 *  platform's own swipe actions (Mail, Reminders). */
const AVG_GLYPH_RATIO = 0.62;
const WIDEST_LABEL_GLYPHS = 6; // "Delete"

/**
 * Width of the action strip (or of one button, at `count: 1`) — the Dynamic
 * Type calculation mirroring `estimateMenuWidth`'s role for the long-press
 * menu. Grows with `fontSize` so a button is never narrower than its own
 * (scaled) label needs, floored at `minButtonWidth` so a tiny font/label
 * doesn't produce a cramped touch target.
 */
export function actionsWidth({
  fontSize,
  iconSize,
  padH,
  gap,
  minButtonWidth,
  count,
}: ActionsWidthInput): number {
  if (count <= 0) return 0;
  const textW = Math.ceil(WIDEST_LABEL_GLYPHS * fontSize * AVG_GLYPH_RATIO);
  const contentW = Math.max(textW, iconSize) + padH * 2;
  const buttonW = Math.max(contentW, minButtonWidth);
  return buttonW * count + gap * (count - 1);
}
