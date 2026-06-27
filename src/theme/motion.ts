/**
 * Motion tokens — the single source of truth for animation easings and
 * durations used across the app. Currently adopted by XavierPet; intended
 * to be the app-wide standard going forward.
 *
 * Easings are expressed as cubic-bezier control-point tuples so callers can
 * pass them directly to Reanimated's Easing.bezier(x1, y1, x2, y2).
 */

/** Cubic-bezier control points [x1, y1, x2, y2] */
export type BezierTuple = [number, number, number, number];

export const EASINGS = {
  /** Standard: symmetrical ease-in-out */
  standard: [0.45, 0, 0.55, 1] as BezierTuple,
  /** Out: decelerate — snappy start, gentle finish */
  out: [0.22, 1, 0.36, 1] as BezierTuple,
  /** Bounce: overshoot, then settle */
  bounce: [0.34, 1.56, 0.64, 1] as BezierTuple,
} as const;

export const DURATIONS = {
  fast: 150,
  normal: 240,
  eye: 340,
  color: 360,
  react: 480,
} as const;

/** Convenience alias so import sites can write `MOTION.ease.out` etc. */
export const MOTION = {
  ease: EASINGS,
  dur: DURATIONS,
} as const;
