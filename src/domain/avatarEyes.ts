/**
 * Pure, framework-free eye-geometry helper.
 *
 * Returns the per-eye shape parameters for a given avatar state and side.
 * All ratio values are fractions of `size` (the avatar diameter). Eye width
 * is always 0.13·size (callers compute that); top border radii are always
 * equal to eye width. This module only encodes what *changes* per state.
 */
import { AvatarState } from './avatar';

export type EyeSide = 'l' | 'r';

export interface EyeGeometry {
  /** Eye height as a fraction of size (e.g. 0.17 → height = 0.17 * size). */
  heightRatio: number;
  /**
   * When true, bottom border radii should be 0 (flat-bottom dome — "happy"
   * closed eye). When false, bottom radii = eye width (full pill).
   */
  flatBottom: boolean;
  /**
   * Clockwise tilt in degrees. Left eye: positive = top leans right (angry
   * brow). Right eye: negative = top leans left.
   */
  tiltDeg: number;
  /**
   * Vertical offset as a fraction of size applied as marginBottom, raising
   * the eye above the baseline. Non-zero only for confused right eye (0.055).
   */
  offsetYRatio: number;
}

/**
 * Returns eye geometry for the given avatar state and eye side.
 *
 * Table:
 * | state           | heightRatio       | flatBottom | tiltDeg (L/R) | offsetYRatio (R) |
 * |-----------------|-------------------|------------|---------------|-----------------|
 * | idle/listening  | 0.17              | false      | 0             | 0               |
 * | thinking        | 0.075             | false      | 0             | 0               |
 * | happy           | 0.105             | true       | 0             | 0               |
 * | confused        | L 0.17 / R 0.10   | false      | 0             | R 0.055         |
 * | angry           | 0.085             | false      | L +16 / R −16 | 0               |
 */
export function eyeGeometry(state: AvatarState, side: EyeSide): EyeGeometry {
  switch (state) {
    case 'idle':
    case 'listening':
      return { heightRatio: 0.17, flatBottom: false, tiltDeg: 0, offsetYRatio: 0 };

    case 'thinking':
      return { heightRatio: 0.075, flatBottom: false, tiltDeg: 0, offsetYRatio: 0 };

    case 'happy':
      return { heightRatio: 0.105, flatBottom: true, tiltDeg: 0, offsetYRatio: 0 };

    case 'confused':
      return {
        heightRatio: side === 'r' ? 0.10 : 0.17,
        flatBottom: false,
        tiltDeg: 0,
        offsetYRatio: side === 'r' ? 0.055 : 0,
      };

    case 'angry':
      return {
        heightRatio: 0.085,
        flatBottom: false,
        tiltDeg: side === 'l' ? 16 : -16,
        offsetYRatio: 0,
      };
  }
}
