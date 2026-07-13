/**
 * useScaledType — the RN half of the app's responsive type/spacing scale
 * (Assistant home + /account Q&A; see docs/design/responsive-scaling-spec.md).
 * Reads `useWindowDimensions().width` + `PixelRatio.getFontScale()` (the same
 * width-reading idiom as dashboard.tsx / ContextMenu / AmountKeypad) and
 * derives:
 *   - a role → px map for the type ramp (screenTitle/heroFigure/prompt/
 *     sectionHeading/body/control/rowLabel/caption), via the pure
 *     `base × widthFactor × dynamicTypeFactor` formula in
 *     src/domain/scaleMath.ts. The role bases themselves (`ROLE_BASE`) live
 *     there too, framework-free, so a transposed base (e.g. body↔control) is
 *     caught by the plain-Node suite;
 *   - width-aware (but not Dynamic-Type-scaled) spacing/touch-target values —
 *     avatar sizes, chip heights, composer height, screen padding, the
 *     step-progress dot — each a literal 3-value table (SE / 15 / Pro Max)
 *     rather than a formula, matching the hifi handoff's spacing tables. The
 *     tables themselves and the width→tier lookup (`byWidth`/`widthTier`)
 *     live in src/domain/scaleMath.ts too, framework-free, so a transposed
 *     table entry is caught by the plain-Node suite.
 *
 * Consumers apply the returned numbers via inline `style={{...}}` — NativeWind
 * utilities can't express a runtime `base × factor`. Colours still come from
 * `useThemeColors()`; this hook only returns numbers.
 */
import { PixelRatio, useWindowDimensions } from 'react-native';
import {
  computeWidthFactor,
  clampFontScale,
  scaledSize,
  byWidth,
  ROLE_BASE,
  ScaleRole,
  AVATAR_IDLE,
  AVATAR_FLOW,
  QUICK_CHIP_HEIGHT,
  CHIP_HEIGHT,
  COMPOSER_HEIGHT,
  SCREEN_PADDING,
  DOT_SIZE,
} from '../domain/scaleMath';

export type { ScaleRole };

export interface ScaledType {
  /** role → px, already width- and Dynamic-Type-scaled. */
  role: Record<ScaleRole, number>;
  /** clamp(0.94, screenWidth / 390, 1.12) — exposed for callers that need it
   *  directly (e.g. a one-off size not in the role ramp). */
  widthFactor: number;
  /** clamp(0.85, PixelRatio.getFontScale(), 1.60). */
  fontScale: number;
  /** XavierAvatar size: idle hero (SE 148 / 15 160 / Pro Max 180). */
  avatarIdle: number;
  /** XavierAvatar size: mid-/account-Q&A (SE 104 / 15 112 / Pro Max 124). */
  avatarFlow: number;
  /** Quick-action chip minHeight on the Assistant home (40 / 42 / 46). */
  quickChipHeight: number;
  /** /account subtype-chip minHeight — the primary 44pt touch-target fix
   *  (44 / 44 / 48). */
  chipHeight: number;
  /** Composer input / camera / send button height (48 / 48 / 52). */
  composerHeight: number;
  /** Screen horizontal padding (24 / 24 / 28). */
  screenPadding: number;
  /** Step-progress dot diameter (8 / 8 / 10). */
  dot: number;
}

export function useScaledType(): ScaledType {
  const { width } = useWindowDimensions();
  const widthFactor = computeWidthFactor(width);
  const fontScale = clampFontScale(PixelRatio.getFontScale());

  const role = {} as Record<ScaleRole, number>;
  (Object.keys(ROLE_BASE) as ScaleRole[]).forEach((key) => {
    role[key] = scaledSize(ROLE_BASE[key], widthFactor, fontScale);
  });

  return {
    role,
    widthFactor,
    fontScale,
    avatarIdle: byWidth(width, AVATAR_IDLE),
    avatarFlow: byWidth(width, AVATAR_FLOW),
    quickChipHeight: byWidth(width, QUICK_CHIP_HEIGHT),
    chipHeight: byWidth(width, CHIP_HEIGHT),
    composerHeight: byWidth(width, COMPOSER_HEIGHT),
    screenPadding: byWidth(width, SCREEN_PADDING),
    dot: byWidth(width, DOT_SIZE),
  };
}
