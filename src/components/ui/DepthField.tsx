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
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useGlass } from '../../theme/useGlass';

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

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: size, height: size }, animatedStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={1} />
            {/* Fading opacity rather than colour keeps the well soft against
                either theme's ground — a fade to a fixed hex would ring. */}
            <Stop offset="60%" stopColor={color} stopOpacity={0.45} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
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
