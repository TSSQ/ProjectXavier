/**
 * Size-relative motion for XavierPet (docs/design/xavier-daily-chat-spec.md §4).
 *
 * Xavier's breathing lift and halo radius were tuned for a 180pt avatar. A
 * small avatar (the pinned header, 52pt) must not bob like the big one, so the
 * lift and the halo radius scale with `size / 180`. At 180 every value is
 * EXACTLY what it was before this module existed (pinned by the BDD suite).
 * Opacities, scale, and durations never depend on size.
 *
 * Pure and framework-free so the maths is tested in plain Node.
 */

/** The size the original constants were tuned at. */
export const PET_REFERENCE_SIZE = 180;
/** A halo smaller than this reads as no glow at all. */
export const PET_HALO_RADIUS_FLOOR = 6;

/** Constants that do not depend on size. */
export const PET_BREATHE = {
  scale: 1.045,
  listeningScale: 1.05,
  ms: 1900,
  listeningMs: 1500,
  /** Lift at the reference size, px (negative is up). */
  lift: -8,
  listeningLift: -6,
  haloMs: 2200,
} as const;

// `'worklet'`: XavierPet evaluates the halo per frame on the UI thread while the
// avatar's visual scale animates. The directive is an inert string in plain Node.
function scaled(value: number, size: number, reference: number): number {
  'worklet';
  return (value * size) / reference;
}

/**
 * The breathing lift at `size`: -8 at the reference (180 by default), about -2.3
 * at 52. `reference` is the size whose motion should read as "exactly as today":
 * the Assistant's avatar passes its own hero size, so the hero looks identical
 * on every device (160 and 148 included), not only at 180.
 */
export function petLift(size: number, listening = false, reference = PET_REFERENCE_SIZE): number {
  return scaled(listening ? PET_BREATHE.listeningLift : PET_BREATHE.lift, size, reference);
}

export interface PetHalo {
  /** Rest and peak opacity (unchanged by size). */
  baseOpacity: number;
  idleOpacity: number;
  /** Rest radius and the extra the pulse adds at its peak. */
  baseRadius: number;
  idleRadius: number;
}

/** Halo values at the reference size: dark .40 -> .75, 16 -> 28; light .25 -> .47, 14 -> 25. */
const HALO_AT_REFERENCE = {
  dark: { baseOpacity: 0.4, idleOpacity: 0.35, from: 16, to: 28 },
  light: { baseOpacity: 0.25, idleOpacity: 0.22, from: 14, to: 25 },
} as const;

/**
 * Each end of the radius range scales with size (relative to `reference`), with
 * the floor applied to both. `size` is the size the avatar APPEARS at on
 * screen, so a view that is drawn big and shrunk by a transform passes
 * `drawnSize * visualScale` here and divides the result by `visualScale`.
 */
export function petHalo(size: number, light: boolean, reference = PET_REFERENCE_SIZE): PetHalo {
  'worklet';
  const ref = light ? HALO_AT_REFERENCE.light : HALO_AT_REFERENCE.dark;
  const from = Math.max(PET_HALO_RADIUS_FLOOR, scaled(ref.from, size, reference));
  const to = Math.max(PET_HALO_RADIUS_FLOOR, scaled(ref.to, size, reference));
  return {
    baseOpacity: ref.baseOpacity,
    idleOpacity: ref.idleOpacity,
    baseRadius: from,
    idleRadius: to - from,
  };
}
