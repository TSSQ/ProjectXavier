/**
 * Liquid Glass tokens — Phase 1 of the Apple Glass UI proposal.
 *
 * Pure and framework-free (no RN/Expo imports) so the tier decision stays
 * testable in the plain-node BDD suite, exactly like the rest of src/domain.
 * The React component that consumes these is src/components/ui/Glass.tsx.
 *
 * ─── What survived translating the proposal into React Native ──────────────
 *
 * The proposal's token table is written in CSS, where a glass surface is a
 * background colour plus `backdrop-filter: blur() saturate()`. React Native
 * has neither, and `expo-glass-effect` doesn't expose them: `GlassView` takes
 * `glassEffectStyle` ('clear' | 'regular' | 'none'), `tintColor`,
 * `isInteractive` and `colorScheme` — that is the whole surface. So:
 *
 *   PROPOSAL TOKEN        FATE
 *   --xg-chrome/card      the rgba FILL is not settable — the OS material
 *                         decides what it looks like. What IS ours is which
 *                         system style each role maps to, so the roles below
 *                         carry `systemStyle` instead of a fill.
 *   --xg-clear            same, mapped to the 'clear' system style.
 *   --xg-tint-primary     real — passed through as `tintColor`.
 *   --xg-edge             real — borderColor.
 *   --xg-specular         real in intent, but RN has no inset box-shadow, so
 *                         it renders as a 1px top-edge overlay, not a shadow.
 *   --xg-blur-sm/md/lg    DROPPED. There is no blur radius to set; the system
 *                         material picks its own. Shipping these would be
 *                         three tokens nothing can read.
 *   --xg-scrim            real — a fill behind money figures (Rule 03).
 *   --xg-field-1/2/3      real — the depth field's three wells.
 *
 * The opaque fallback colours are NOT in the proposal (it says "solid
 * #171B22"), but a single hard-coded hex can't serve both themes, so each
 * role carries its own `fallback` drawn from the existing palette.
 */
import { darkColors, lightColors } from './tokens';

/** Which system material a role asks for. `expo-glass-effect`'s GlassStyle. */
export type GlassSystemStyle = 'clear' | 'regular';

/** The proposal's four glass roles (its fifth tier, "Solid", is the absence
 *  of glass — chart plot areas, keypads, focused fields — and is deliberately
 *  NOT a role here: those surfaces keep using `surface` directly, so "this is
 *  opaque on purpose" stays visible at the call site.) */
export type GlassRole = 'chrome' | 'card' | 'clear' | 'tinted';

export interface GlassRoleTokens {
  /** The system material to request on the native tier. */
  systemStyle: GlassSystemStyle;
  /** Accent tint, when the role is a tinted one. */
  tint?: string;
  /** Flat colour used when the native tier isn't available. */
  fallback: string;
  /** Hairline edge colour (replaces the flat `border` on glass). */
  edge: string;
  /** Top-edge highlight colour — a 1px overlay, see the header note. */
  specular: string;
}

export interface GlassTokens {
  chrome: GlassRoleTokens;
  card: GlassRoleTokens;
  clear: GlassRoleTokens;
  tinted: GlassRoleTokens;
  /** Contrast floor painted under money on glass (proposal Rule 03). */
  scrim: string;
  /** The depth field's three wells, in the brand's own hues. */
  field: readonly [string, string, string];
  /** Inset a floating (detached) chrome surface from the screen edges. */
  floatingSideInset: number;
  /** Gap between a floating surface and the safe-area bottom. */
  floatingBottomGap: number;
}

// The proposal gives edge/specular once per theme rather than per role, so
// they're lifted here and spread into every role.
const DARK_EDGE = 'rgba(255,255,255,0.10)';
const DARK_SPECULAR = 'rgba(255,255,255,0.16)';
const LIGHT_EDGE = 'rgba(20,28,45,0.10)';
// Near-white on light, per the proposal: on white the lip flips from a faint
// sheen to a bright rim, which is what keeps a pale glass edge readable.
const LIGHT_SPECULAR = 'rgba(255,255,255,0.90)';

export const darkGlass: GlassTokens = {
  chrome: {
    systemStyle: 'regular',
    fallback: darkColors.surface,
    edge: DARK_EDGE,
    specular: DARK_SPECULAR,
  },
  card: {
    systemStyle: 'regular',
    fallback: darkColors.surface,
    edge: DARK_EDGE,
    specular: DARK_SPECULAR,
  },
  clear: {
    systemStyle: 'clear',
    fallback: darkColors.surfaceAlt,
    edge: DARK_EDGE,
    specular: DARK_SPECULAR,
  },
  tinted: {
    systemStyle: 'regular',
    tint: 'rgba(91,141,239,0.68)',
    fallback: darkColors.primary,
    edge: DARK_EDGE,
    specular: DARK_SPECULAR,
  },
  scrim: 'rgba(14,17,22,0.55)',
  field: ['rgba(91,141,239,0.20)', 'rgba(124,91,239,0.18)', 'rgba(51,194,127,0.12)'],
  floatingSideInset: 16,
  floatingBottomGap: 8,
};

export const lightGlass: GlassTokens = {
  chrome: {
    systemStyle: 'regular',
    fallback: lightColors.surface,
    edge: LIGHT_EDGE,
    specular: LIGHT_SPECULAR,
  },
  card: {
    systemStyle: 'regular',
    fallback: lightColors.surface,
    edge: LIGHT_EDGE,
    specular: LIGHT_SPECULAR,
  },
  clear: {
    systemStyle: 'clear',
    fallback: lightColors.surfaceAlt,
    edge: LIGHT_EDGE,
    specular: LIGHT_SPECULAR,
  },
  tinted: {
    systemStyle: 'regular',
    tint: 'rgba(47,107,221,0.82)',
    fallback: lightColors.primary,
    edge: LIGHT_EDGE,
    specular: LIGHT_SPECULAR,
  },
  scrim: 'rgba(255,255,255,0.72)',
  // Roughly half strength on light, per the proposal's light-appearance pass.
  field: ['rgba(47,107,221,0.14)', 'rgba(106,69,222,0.12)', 'rgba(20,145,88,0.10)'],
  floatingSideInset: 16,
  floatingBottomGap: 8,
};

export function glassTokensFor(scheme: 'dark' | 'light'): GlassTokens {
  return scheme === 'dark' ? darkGlass : lightGlass;
}

// ─── tier resolution ────────────────────────────────────────────────────────

/** Which rendering the `<Glass>` primitive should use. The proposal specifies
 *  three tiers, but the middle one (iOS 18–25 via expo-blur) is unreachable
 *  here: this app's deployment target is iOS 26.0 (app.config.ts /
 *  Podfile.properties.json), so no device that can install it lacks the glass
 *  API for version reasons. Shipping a blur tier — and the expo-blur
 *  dependency it needs — would be dead code, so there are two tiers. */
export type GlassTier = 'native' | 'opaque';

export interface GlassEnvironment {
  /** `isLiquidGlassAvailable()` from expo-glass-effect. */
  liquidGlassAvailable: boolean;
  /** `isGlassEffectAPIAvailable()` — some iOS 26 betas ship without the API
   *  and CRASH when GlassView mounts, which is why this is a separate gate. */
  glassApiAvailable: boolean;
  /** `AccessibilityInfo.isReduceTransparencyEnabled()`. */
  reduceTransparency: boolean;
  /** The build-time flag (flags.ts) — Phase 1 ships dark. */
  flagEnabled: boolean;
}

/**
 * Resolve the rendering tier. Every input must be true for glass to render;
 * anything unknown or unavailable falls back to opaque.
 *
 * `reduceTransparency` is its own input on purpose. It is tempting to assume
 * `isLiquidGlassAvailable()` covers it — the POC in this repo said so in a
 * comment, and it is wrong. That function's own documentation reads: "The
 * value may also be `true` if the user has enabled accessibility settings
 * that limit the Liquid Glass effect. To check if the user has disabled the
 * Liquid Glass effect via accessibility settings, use
 * AccessibilityInfo.isReduceTransparencyEnabled()." Getting this wrong is an
 * accessibility failure rather than a cosmetic one, which is why it is a
 * pure, directly-tested decision instead of a condition inline in a
 * component.
 */
export function resolveGlassTier(env: GlassEnvironment): GlassTier {
  if (!env.flagEnabled) return 'opaque';
  if (!env.liquidGlassAvailable) return 'opaque';
  if (!env.glassApiAvailable) return 'opaque';
  if (env.reduceTransparency) return 'opaque';
  return 'native';
}
