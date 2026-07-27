/**
 * Pure layout math for the welcome carousel's chrome (app/welcome.tsx). At
 * large Dynamic Type the card's title/body text grows but two pieces of
 * "chrome" drawn on top of the horizontal pager do NOT reserve any real
 * space for that growth:
 *   - the absolutely-positioned Skip button (top-right) — the title, which
 *     is vertically centred by `justifyContent: 'center'`, can grow tall
 *     enough at large scale to run full-bleed underneath it;
 *   - the absolutely-positioned page-dots + "Get Started" button (bottom) —
 *     a hard-coded `paddingBottom` guess doesn't grow with the button's own
 *     scaled text, so at large scale the dots render on top of the body
 *     paragraph and the bottom of the text clips off-screen.
 *
 * `computeOnboardingChromeReserves` derives the ACTUAL top/bottom space each
 * piece of chrome occupies — from the safe-area insets plus the same scaled
 * sizes the chrome renders at (see useScaledType.ts) — so app/welcome.tsx can
 * feed those into each card's padding instead of guessing. Kept
 * framework-free (no react-native import), like src/domain/scaleMath.ts, so
 * it's covered by the plain-Node BDD suite.
 *
 * The fixed 140pt onboarding visual (AssistantAvatar / icon circle) is also
 * eating space the text needs at large scale, so
 * `computeOnboardingVisualSize` shrinks it as `fontScale` climbs — clamped so
 * it never grows past its original 140pt (a font scale below 1 shouldn't
 * enlarge it) nor shrinks below a usable floor.
 */

/** Matches the Skip `Pressable`'s `top: insets.top + 12` in app/welcome.tsx. */
const SKIP_TOP_OFFSET = 12;
/** Matches the Skip `Pressable`'s `paddingVertical: 8` (applies top AND
 *  bottom, so the button's own height is `2 ×` this plus its text). */
const SKIP_VERTICAL_PADDING = 8;
/** Matches the title's own `lineHeight: fontSize * 1.25` in app/welcome.tsx —
 *  reused here so the Skip label's line-height assumption doesn't drift from
 *  the rest of the screen's type. */
const LINE_HEIGHT_FACTOR = 1.25;
/** Breathing room between the reserved chrome and the card's own content,
 *  so text never sits flush against the Skip button or the dots row. */
const CHROME_GAP = 16;

/** Matches the dots+button wrapper's `bottom: insets.bottom + 24` in
 *  app/welcome.tsx. */
const BOTTOM_OFFSET = 24;
/** Matches the dots row's `mb-5` (NativeWind spacing scale: `5 * 4px`). */
const DOTS_MARGIN_BOTTOM = 20;
/** Matches `Button`'s `text-base` (src/components/ui/Button.tsx) — the base
 *  px "Get Started" renders at before Dynamic Type scaling. */
const BUTTON_FONT_BASE = 16;
/** Matches `Button`'s `py-3` (NativeWind spacing scale: `3 * 4px`), applied
 *  top AND bottom. */
const BUTTON_VERTICAL_PADDING = 12;

/** The onboarding visual's un-scaled size (`AssistantAvatar`/icon circle at
 *  default Dynamic Type) — the ceiling `computeOnboardingVisualSize` never
 *  grows past. */
export const ONBOARDING_VISUAL_BASE = 140;
/** The onboarding visual's floor — small enough to free up real space for
 *  text at the largest Dynamic Type sizes, large enough to still read as the
 *  card's visual rather than a decorative dot. */
export const ONBOARDING_VISUAL_MIN = 84;

export interface OnboardingChromeInput {
  /** Top safe-area inset (`useSafeAreaInsets().top`). */
  insetsTop: number;
  /** Bottom safe-area inset (`useSafeAreaInsets().bottom`). */
  insetsBottom: number;
  /** The Skip label's scaled font size (`useScaledType().role.control`). */
  skipFontSize: number;
  /** The page-dots' scaled diameter (`useScaledType().dot`). */
  dotSize: number;
  /** clamp(0.85, PixelRatio.getFontScale(), 1.60) — `useScaledType().fontScale`.
   *  Drives the "Get Started" button's own text scaling (it isn't routed
   *  through the role ramp — see src/components/ui/Button.tsx) and the
   *  visual's shrink. */
  fontScale: number;
}

export interface OnboardingChromeReserves {
  /** Card `paddingTop` — clears the Skip button at any font scale. */
  topReserve: number;
  /** Card `paddingBottom` — clears the dots row + "Get Started" button at
   *  any font scale. Reserved on every card (not just the last), so a card's
   *  padding — and therefore its vertical centring — doesn't jump as the
   *  user pages onto/off the last card. */
  bottomReserve: number;
}

/** `paddingTop` a carousel card needs so its centred content can never sit
 *  under the Skip button, at any font scale or safe-area inset. */
export function computeOnboardingTopReserve(
  insetsTop: number,
  skipFontSize: number
): number {
  const skipTextHeight = Math.round(skipFontSize * LINE_HEIGHT_FACTOR);
  return insetsTop + SKIP_TOP_OFFSET + SKIP_VERTICAL_PADDING * 2 + skipTextHeight + CHROME_GAP;
}

/** `paddingBottom` a carousel card needs so its centred content can never
 *  sit under the dots row + "Get Started" button, at any font scale or
 *  safe-area inset. */
export function computeOnboardingBottomReserve(
  insetsBottom: number,
  dotSize: number,
  fontScale: number
): number {
  const buttonFontSize = Math.round(BUTTON_FONT_BASE * fontScale);
  const buttonTextHeight = Math.round(buttonFontSize * LINE_HEIGHT_FACTOR);
  const buttonHeight = buttonTextHeight + BUTTON_VERTICAL_PADDING * 2;
  const dotsRowHeight = dotSize + DOTS_MARGIN_BOTTOM;
  return insetsBottom + BOTTOM_OFFSET + dotsRowHeight + buttonHeight + CHROME_GAP;
}

/** Both reserves in one call — what app/welcome.tsx actually consumes. */
export function computeOnboardingChromeReserves(
  input: OnboardingChromeInput
): OnboardingChromeReserves {
  return {
    topReserve: computeOnboardingTopReserve(input.insetsTop, input.skipFontSize),
    bottomReserve: computeOnboardingBottomReserve(
      input.insetsBottom,
      input.dotSize,
      input.fontScale
    ),
  };
}

/** The onboarding visual's size at a given (clamped) font scale — 140pt at
 *  the default scale (1), shrinking linearly to `ONBOARDING_VISUAL_MIN` as
 *  `fontScale` climbs to its clamp ceiling (1.6), and never growing past
 *  140pt for a font scale below 1. */
export function computeOnboardingVisualSize(fontScale: number): number {
  const shrinkPerScaleUnit = ONBOARDING_VISUAL_BASE - ONBOARDING_VISUAL_MIN;
  const size = ONBOARDING_VISUAL_BASE - (fontScale - 1) * shrinkPerScaleUnit;
  return Math.round(Math.min(ONBOARDING_VISUAL_BASE, Math.max(ONBOARDING_VISUAL_MIN, size)));
}

/** How much vertical space is left for a card's own content once both
 *  reserves are carved out of the viewport — used to assert the reserves
 *  can never eat the *entire* viewport (which would leave nothing for the
 *  title/body, however much they get to scroll for). Not itself clamped to
 *  zero: a genuinely too-small screen SHOULD surface as a non-positive
 *  number here rather than being silently hidden. */
export function computeOnboardingContentHeight(
  screenHeight: number,
  reserves: OnboardingChromeReserves
): number {
  return screenHeight - reserves.topReserve - reserves.bottomReserve;
}
