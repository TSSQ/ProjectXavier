/**
 * Pure arithmetic behind the app's responsive type/spacing scale (Assistant
 * home + /account Q&A — see docs/design/responsive-scaling-spec.md). The app
 * hard-codes point sizes tuned for a ~390pt canvas and ignores Dynamic Type;
 * this module derives a size from a role's base value, the screen width, and
 * the user's font-scale setting:
 *
 *   size = base × widthFactor × dynamicTypeFactor
 *
 * Kept framework-free (no react-native import) so it's covered by the plain-
 * Node BDD suite — src/theme/useScaledType.ts is the thin RN hook that wraps
 * this with useWindowDimensions()/PixelRatio.
 */
import { typography } from '../theme/tokens';

function clamp(min: number, value: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** widthFactor = clamp(0.94, screenWidth / 390, 1.12). 390pt is the scale's
 *  reference width; narrower phones (SE/mini) floor at 0.94 so text never
 *  shrinks further, wider ones (Pro Max) cap at 1.12 so it never balloons. */
export function computeWidthFactor(screenWidth: number): number {
  return clamp(0.94, screenWidth / 390, 1.12);
}

/** dynamicTypeFactor = clamp(0.85, rawFontScale, 1.60). `rawFontScale` is the
 *  OS-reported scale (e.g. PixelRatio.getFontScale()); capping it keeps
 *  Accessibility Dynamic Type sizes from exploding the layout while still
 *  growing text for smaller boosts. */
export function clampFontScale(rawFontScale: number): number {
  return clamp(0.85, rawFontScale, 1.6);
}

/** size = round(base × widthFactor × fontScale) — the final on-screen px for
 *  a role, given its base (at 390pt / default Dynamic Type) and the two
 *  factors above. */
export function scaledSize(base: number, widthFactor: number, fontScale: number): number {
  return Math.round(base * widthFactor * fontScale);
}

/** Base px for each type-ramp role at the 390pt reference width / default
 *  Dynamic Type (docs/design/responsive-scaling-spec.md's role ramp table).
 *  `prompt` is sourced from tokens.ts's `typography.prompt` — the single
 *  place that value is declared — so the hook and the token can't drift;
 *  the rest of the ramp is only used by this scale so it lives here rather
 *  than growing tokens.ts's (currently otherwise-unused) typography scale
 *  beyond what the spec asked for. Kept here (not inline in the RN hook) so
 *  a transposed base (e.g. body↔control) is caught by the plain-Node suite
 *  instead of only a simulator screenshot. */
export const ROLE_BASE = {
  screenTitle: 30,
  heroFigure: 34,
  prompt: typography.prompt,
  sectionHeading: 22,
  body: 17,
  control: 16,
  rowLabel: 15,
  caption: 14,
} as const;

export type ScaleRole = keyof typeof ROLE_BASE;

/**
 * Width-tiered spacing/touch-target tables (avatar sizes, chip heights,
 * composer height, screen padding, the step-progress dot). Unlike the role
 * ramp above, the hifi handoff gives these as three literal per-device
 * numbers (SE / 15 / Pro Max) rather than a base×widthFactor formula — e.g.
 * the idle avatar is 148/160/180, not round(160 × widthFactor). `widthTier`
 * + `byWidth` pick the right entry from a screen width; kept here (rather
 * than in the RN hook) so a transposed table — e.g. swapping the subtype
 * chip's SE/Pro-Max entries and silently un-fixing the 44pt touch target —
 * is caught by the plain-Node suite instead of only a simulator screenshot.
 */
export type WidthTiered = readonly [se: number, standard: number, proMax: number];

/** Which of the three reference tiers (SE 375pt / 15 393pt / Pro Max 430pt)
 *  `screenWidth` falls into. Breakpoints sit at the midpoints between those
 *  reference widths: (375+393)/2 = 384, (393+430)/2 = 411.5. */
export function widthTier(screenWidth: number): 0 | 1 | 2 {
  if (screenWidth < 384) return 0;
  if (screenWidth < 411.5) return 1;
  return 2;
}

/** Look up `values` (SE/standard/Pro Max) for `screenWidth`. */
export function byWidth(screenWidth: number, values: WidthTiered): number {
  return values[widthTier(screenWidth)];
}

/** XavierAvatar size — idle hero (Assistant home). */
export const AVATAR_IDLE: WidthTiered = [148, 160, 180];
/** XavierAvatar size — mid-/account-Q&A (was hard-coded 96). */
export const AVATAR_FLOW: WidthTiered = [104, 112, 124];
/** Quick-action chip minHeight on the Assistant home. */
export const QUICK_CHIP_HEIGHT: WidthTiered = [40, 42, 46];
/** /account subtype-chip minHeight — the primary 44pt touch-target fix
 *  (was ~30pt). */
export const CHIP_HEIGHT: WidthTiered = [44, 44, 48];
/** Composer input / camera / send button height. */
export const COMPOSER_HEIGHT: WidthTiered = [48, 48, 52];
/** Screen horizontal padding. */
export const SCREEN_PADDING: WidthTiered = [24, 24, 28];
/** Step-progress dot diameter. */
export const DOT_SIZE: WidthTiered = [8, 8, 10];
