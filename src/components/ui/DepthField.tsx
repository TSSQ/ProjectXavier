/**
 * The depth field — the proposal's one background gradient, and the reason
 * the material reads as glass at all.
 *
 * Glass over a flat #0E1116 looks like grey plastic, because a system
 * material samples what is behind it and there is nothing there to sample.
 * The POC screenshots showed exactly this: refraction was visible on the
 * Transactions screen, where a ledger scrolled underneath, and the same bar
 * read as plastic on the emptier screens. Three very soft, slowly drifting
 * wells in the brand's own hues give every glass edge something to bend.
 *
 * Procedural — no assets. Rendered with `react-native-svg`'s RadialGradient,
 * which is already a dependency (Sparkline, DonutChart, MultiLineChart use
 * it), so this costs no new package. The drift animates a container
 * transform rather than SVG attributes: same motion, none of the fragility
 * of animated SVG props.
 *
 * Never sits behind text directly — it renders at the very back of a screen,
 * beneath content, and is pointerEvents="none" throughout.
 */
import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useGlass } from '../../theme/useGlass';

/**
 * Parses a colour string into a hex triplet plus a separate numeric alpha.
 *
 * react-native-svg does not reliably honour an alpha channel embedded in a
 * `stopColor` string (rgba()/#rrggbbaa) — on device the wells rendered at
 * full, saturated strength regardless of the tokens' alphas. The fix is to
 * never ask stopColor to carry opacity at all: split it out here and drive
 * fade ONLY through the numeric `stopOpacity` prop (see `Well` below).
 *
 * Falls back sensibly for a plain `#rrggbb`/`#rgb` hex (alpha 1) or an
 * `rgb(r,g,b)` string (alpha 1); anything unrecognised also falls back to
 * opaque black rather than throwing, since this only ever feeds a decorative
 * gradient.
 */
/*
 * Round-2 fix note — the SEAM (not the saturation) had a second, separate
 * cause, found by instrumenting the well with on-screen pixel-row markers
 * at its computed edges and sampling actual rendered colour on either side:
 * with `cx="50%" cy="50%" r="50%"` (the default `objectBoundingBox` units),
 * the gradient's outer ~20% of its radius was never reached — the fade
 * visibly PLATEAUED at roughly the offset-0.6 value and held constant out
 * to the shape's true edge, where the Circle's own geometry then cut it off
 * hard. That plateau-then-cliff was the seam; it reproduced identically
 * with 2 stops or 3, so it was never about stop count. Switching the
 * gradient to `gradientUnits="userSpaceOnUse"` with `cx`/`cy`/`r` given as
 * the SAME absolute numbers as the `Circle`'s own geometry removes the
 * percentage-of-bounding-box math entirely, and the fade now measures
 * smooth and continuous all the way to the edge (verified by sampling
 * pixel rows across the well's bottom boundary before/after).
 */
function parseColor(input: string): { hex: string; alpha: number } {
  const rgba = input.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
  );
  if (rgba) {
    const [, r, g, b, a] = rgba;
    return {
      hex: toHex(Number(r ?? 0), Number(g ?? 0), Number(b ?? 0)),
      alpha: a === undefined ? 1 : Number(a),
    };
  }
  const hex6 = input.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return { hex: `#${hex6[1]}`, alpha: 1 };
  const hex3 = input.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r = '0', g = '0', b = '0'] = hex3[1]?.split('') ?? [];
    return { hex: `#${r}${r}${g}${g}${b}${b}`, alpha: 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Per-well drift periods, inside the proposal's 22–34s band. Deliberately
 *  co-prime-ish so the three never resynchronise into an obvious pulse. */
const PERIODS_MS = [23_000, 29_000, 34_000] as const;

/** Where each well sits, as a fraction of the screen, and how far it drifts.
 *  Kept away from the vertical middle, where body copy lives. */
const WELLS = [
  { cx: 0.18, cy: 0.12, driftX: 26, driftY: 18 },
  { cx: 0.86, cy: 0.34, driftX: -22, driftY: 24 },
  { cx: 0.40, cy: 0.92, driftX: 18, driftY: -20 },
] as const;

interface WellProps {
  color: string;
  size: number;
  left: number;
  top: number;
  driftX: number;
  driftY: number;
  periodMs: number;
  animate: boolean;
  id: string;
}

function Well({ color, size, left, top, driftX, driftY, periodMs, animate, id }: WellProps) {
  const t = useSharedValue(0);

  React.useEffect(() => {
    if (!animate) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: periodMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [animate, periodMs, t]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: t.value * driftX }, { translateY: t.value * driftY }],
  }));

  const { hex, alpha } = parseColor(color);

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: size, height: size }, animatedStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient
            id={id}
            // userSpaceOnUse + the SAME absolute cx/cy/r as the Circle below
            // (rather than the default objectBoundingBox "50%" percentages):
            // see the round-2 fix note above — this is what actually made
            // the fade reach true zero at the edge instead of plateauing.
            gradientUnits="userSpaceOnUse"
            cx={size / 2}
            cy={size / 2}
            r={size / 2}
          >
            <Stop offset={0} stopColor={hex} stopOpacity={alpha} />
            <Stop offset={0.6} stopColor={hex} stopOpacity={alpha * 0.45} />
            <Stop offset={1} stopColor={hex} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* A Circle, not a Rect: nothing outside the radius can paint
            regardless of how the gradient itself behaves, so any residual
            seam at the well's bounding-box edge disappears by construction
            rather than by tuning the fade. */}
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Renders nothing unless the glass tier is active — with the material off,
 * the field has no job and would just be a coloured haze over a flat theme.
 */
export function DepthField() {
  const { tier, tokens } = useGlass();
  const { width, height } = useWindowDimensions();
  // Honours the system Reduce Motion setting; the wells then hold a fixed
  // position rather than disappearing, so the material still has something
  // to refract.
  const reducedMotion = useReducedMotion();

  if (tier !== 'native') return null;

  // Generously oversized so the soft edge never shows a boundary on screen.
  const size = Math.max(width, height) * 0.9;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {WELLS.map((well, i) => (
        <Well
          key={i}
          id={`xv-depth-well-${i}`}
          color={tokens.field[i] ?? tokens.field[0]}
          size={size}
          left={well.cx * width - size / 2}
          top={well.cy * height - size / 2}
          driftX={well.driftX}
          driftY={well.driftY}
          periodMs={PERIODS_MS[i] ?? PERIODS_MS[0]}
          animate={!reducedMotion}
        />
      ))}
    </View>
  );
}
