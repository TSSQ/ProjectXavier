/**
 * Xavier — the assistant's animated "pet" avatar. An SVG gradient blob that is
 * always subtly alive (breathing + blinking) and reacts to the assistant state:
 *   idle · listening · thinking · happy · confused · angry
 *
 * Motion model:
 * - State changes TWEEN: eyes morph (340ms), body/glow color crossfades (360ms),
 *   accessories fade ± scale (360ms), and a one-shot reaction pop fires (480ms).
 * - Ambient loops run independently of transitions (breathe, hop, shake, blink,
 *   glow-pulse, thinking-dots, listening-ring).
 * - Reduced-motion: geometry/color tweens still update; loops and reaction pop
 *   are skipped.
 *
 * Motion is driven by Reanimated; no native build needed beyond the libraries
 * already in the project (react-native-reanimated, react-native-svg).
 */
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Ellipse } from 'react-native-svg';
import { AvatarState, AvatarLook, lookById } from '../../domain/avatar';
import { eyeGeometry } from '../../domain/avatarEyes';
import { MOTION } from '../../theme/motion';

const DARK = '#0E1116';

// Angry gradient colors (override any look).
const ANGRY_FROM = '#F4707E';
const ANGRY_TO = '#C4302E';
const ANGRY_GLOW = '#C4302E';

export function XavierPet({
  size = 96,
  state = 'idle',
  look = lookById('xavier'),
}: {
  size?: number;
  state?: AvatarState;
  look?: AvatarLook;
}) {
  const reducedMotion = useReducedMotion();

  // ── Ambient loop shared values ──────────────────────────────────────────────
  // breathe: the single breathing scale factor (becomes per-axis when combined
  //   with reactX/reactY, see bodyStyle below).
  const breathe = useSharedValue(1);
  const ty = useSharedValue(0);
  const tx = useSharedValue(0);
  const eye = useSharedValue(1); // eye container scaleY (blink)
  const ring = useSharedValue(0); // listening pulse 0..1 (starts at 0 = faded, begins looping when listening)
  const ringVisible = useSharedValue(state === 'listening' ? 1 : 0); // 0 = hidden entirely
  // Three separate shared values for thinking dots (120ms stagger between each)
  const dot0 = useSharedValue(0);
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const idleGlow = useSharedValue(0); // idle glow pulse 0..1

  // ── Reaction pop (one-shot squash-and-stretch on state change) ──────────────
  const reactX = useSharedValue(1);
  const reactY = useSharedValue(1);
  // Guard: do NOT fire on initial mount, and only fire when state actually changes.
  const isFirstRender = useRef(true);
  const prevState = useRef(state);

  // ── Color crossfade ─────────────────────────────────────────────────────────
  // angryProg: 0 = look colors, 1 = angry red. Drives body gradient + glow.
  const angryProg = useSharedValue(state === 'angry' ? 1 : 0);

  // ── Per-eye geometry shared values (left) ───────────────────────────────────
  const lHeight = useSharedValue(size * eyeGeometry(state, 'l').heightRatio);
  const lBottomR = useSharedValue(
    eyeGeometry(state, 'l').flatBottom ? 0 : size * 0.13
  );
  const lTilt = useSharedValue(eyeGeometry(state, 'l').tiltDeg);
  const lOffsetY = useSharedValue(size * eyeGeometry(state, 'l').offsetYRatio);

  // ── Per-eye geometry shared values (right) ──────────────────────────────────
  const rHeight = useSharedValue(size * eyeGeometry(state, 'r').heightRatio);
  const rBottomR = useSharedValue(
    eyeGeometry(state, 'r').flatBottom ? 0 : size * 0.13
  );
  const rTilt = useSharedValue(eyeGeometry(state, 'r').tiltDeg);
  const rOffsetY = useSharedValue(size * eyeGeometry(state, 'r').offsetYRatio);

  // ── Accessories: thinking dots + cheeks opacity/scale ───────────────────────
  const dotsOpacity = useSharedValue(state === 'thinking' ? 1 : 0);
  const cheeksOpacity = useSharedValue(state === 'happy' ? 1 : 0);
  const cheeksScale = useSharedValue(state === 'happy' ? 1 : 0.4);

  const eyeW = size * 0.13;
  const gap = size * 0.12;

  // ── Effect: update all animated values when state changes ───────────────────
  useEffect(() => {
    const ease = Easing.bezier(...MOTION.ease.standard);
    const eyeEase = Easing.bezier(...MOTION.ease.out);
    const bounceEase = Easing.bezier(...MOTION.ease.bounce);

    // ── Ambient loops ─────────────────────────────────────────────────────────
    cancelAnimation(breathe);
    cancelAnimation(ty);
    cancelAnimation(tx);
    cancelAnimation(eye);
    cancelAnimation(ring);
    cancelAnimation(ringVisible);
    cancelAnimation(dot0);
    cancelAnimation(dot1);
    cancelAnimation(dot2);
    cancelAnimation(idleGlow);

    if (!reducedMotion) {
      const breatheMs = state === 'listening' ? 1500 : 1900;
      const breatheToScale = state === 'listening' ? 1.05 : 1.045;
      const breatheToTy = state === 'listening' ? -6 : -8;

      if (state === 'happy') {
        // Hop: up, bounce back
        ty.value = withRepeat(
          withSequence(
            withTiming(-20, { duration: 300, easing: Easing.out(Easing.quad) }),
            withTiming(4, { duration: 200, easing: ease }),
            withTiming(-6, { duration: 150, easing: ease }),
            withTiming(0, { duration: 250, easing: Easing.bounce })
          ),
          -1
        );
        breathe.value = withRepeat(
          withTiming(1.045, { duration: 900, easing: ease }),
          -1,
          true
        );
      } else if (state === 'confused') {
        // Shake horizontally — 5 × 110ms = 550ms per cycle (spec)
        tx.value = withRepeat(
          withSequence(
            withTiming(-7, { duration: 110 }),
            withTiming(7, { duration: 110 }),
            withTiming(-4, { duration: 110 }),
            withTiming(4, { duration: 110 }),
            withTiming(0, { duration: 110 })
          ),
          -1
        );
        breathe.value = withRepeat(
          withTiming(1.045, { duration: 1900, easing: ease }),
          -1,
          true
        );
        ty.value = withRepeat(
          withTiming(breatheToTy, { duration: 1900, easing: ease }),
          -1,
          true
        );
      } else {
        // Standard breathe (idle / thinking / angry / listening)
        breathe.value = withRepeat(
          withTiming(breatheToScale, { duration: breatheMs, easing: ease }),
          -1,
          true
        );
        ty.value = withRepeat(
          withTiming(breatheToTy, { duration: breatheMs, easing: ease }),
          -1,
          true
        );
        tx.value = withTiming(0, { duration: MOTION.dur.fast });
      }

      // Blink (idle/listening)
      if (state === 'idle' || state === 'listening') {
        const blinkGap = state === 'listening' ? 3000 : 4200;
        eye.value = withRepeat(
          withSequence(
            withTiming(1, { duration: blinkGap }),
            withTiming(0.1, { duration: 80 }),
            withTiming(1, { duration: 80 })
          ),
          -1
        );
      } else {
        eye.value = withTiming(1, { duration: MOTION.dur.fast });
      }

      // Listening ring — ringVisible gates overall visibility; ring drives the pulse animation
      ringVisible.value = withTiming(state === 'listening' ? 1 : 0, {
        duration: MOTION.dur.fast,
      });
      if (state === 'listening') {
        ring.value = withRepeat(
          withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
          -1,
          false
        );
      } else {
        ring.value = 0;
      }

      // Thinking dots bob — each dot has its own shared value with 120ms stagger
      if (state === 'thinking') {
        dot0.value = withRepeat(withTiming(1, { duration: 500, easing: ease }), -1, true);
        dot1.value = withDelay(120, withRepeat(withTiming(1, { duration: 500, easing: ease }), -1, true));
        dot2.value = withDelay(240, withRepeat(withTiming(1, { duration: 500, easing: ease }), -1, true));
      } else {
        dot0.value = withTiming(0, { duration: MOTION.dur.fast });
        dot1.value = withTiming(0, { duration: MOTION.dur.fast });
        dot2.value = withTiming(0, { duration: MOTION.dur.fast });
      }

      // Idle glow pulse
      idleGlow.value = state === 'idle'
        ? withRepeat(withTiming(1, { duration: 2200, easing: ease }), -1, true)
        : withTiming(0, { duration: MOTION.dur.normal });
    } else {
      // Reduced motion: reset everything to resting values immediately.
      breathe.value = 1;
      ty.value = 0;
      tx.value = 0;
      eye.value = 1;
      ring.value = 0;
      ringVisible.value = 0;
      dot0.value = 0;
      dot1.value = 0;
      dot2.value = 0;
      idleGlow.value = 0;
    }

    // ── Eye geometry tweens ───────────────────────────────────────────────────
    const lg = eyeGeometry(state, 'l');
    const rg = eyeGeometry(state, 'r');
    const eyeTiming = { duration: MOTION.dur.eye, easing: eyeEase };

    lHeight.value = withTiming(size * lg.heightRatio, eyeTiming);
    lBottomR.value = withTiming(lg.flatBottom ? 0 : eyeW, eyeTiming);
    lTilt.value = withTiming(lg.tiltDeg, eyeTiming);
    lOffsetY.value = withTiming(size * lg.offsetYRatio, eyeTiming);

    rHeight.value = withTiming(size * rg.heightRatio, eyeTiming);
    rBottomR.value = withTiming(rg.flatBottom ? 0 : eyeW, eyeTiming);
    rTilt.value = withTiming(rg.tiltDeg, eyeTiming);
    rOffsetY.value = withTiming(size * rg.offsetYRatio, eyeTiming);

    // ── Color crossfade ───────────────────────────────────────────────────────
    angryProg.value = withTiming(state === 'angry' ? 1 : 0, {
      duration: MOTION.dur.color,
    });

    // ── Accessories ───────────────────────────────────────────────────────────
    const accessTiming = { duration: MOTION.dur.color };
    dotsOpacity.value = withTiming(state === 'thinking' ? 1 : 0, accessTiming);
    cheeksOpacity.value = withTiming(state === 'happy' ? 1 : 0, accessTiming);
    cheeksScale.value = withTiming(
      state === 'happy' ? 1 : 0.4,
      { duration: MOTION.dur.color, easing: bounceEase }
    );

    // ── Reaction pop (one-shot; not on first mount; only on actual state change) ─
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevState.current = state;
    } else if (!reducedMotion && prevState.current !== state) {
      // Approximated keyframes: (1,1) → @28% (1.14,0.88) → @60% (0.94,1.07)
      //   → @82% (1.02,0.99) → (1,1) over 480ms total.
      // Segment durations based on offsets: 28%→134ms, 32%→154ms, 22%→106ms, 18%→86ms.
      const seg1 = Math.round(MOTION.dur.react * 0.28);   // 134ms
      const seg2 = Math.round(MOTION.dur.react * 0.32);   // 154ms
      const seg3 = Math.round(MOTION.dur.react * 0.22);   // 106ms
      const seg4 = MOTION.dur.react - seg1 - seg2 - seg3; // 86ms
      const bounce = Easing.bezier(...MOTION.ease.bounce);

      reactX.value = withSequence(
        withTiming(1.14, { duration: seg1, easing: bounce }),
        withTiming(0.94, { duration: seg2, easing: bounce }),
        withTiming(1.02, { duration: seg3, easing: bounce }),
        withTiming(1, { duration: seg4, easing: bounce })
      );
      reactY.value = withSequence(
        withTiming(0.88, { duration: seg1, easing: bounce }),
        withTiming(1.07, { duration: seg2, easing: bounce }),
        withTiming(0.99, { duration: seg3, easing: bounce }),
        withTiming(1, { duration: seg4, easing: bounce })
      );
    }
    prevState.current = state;
  }, [
    state,
    reducedMotion,
    size,
    eyeW,
    breathe,
    ty,
    tx,
    eye,
    ring,
    ringVisible,
    dot0,
    dot1,
    dot2,
    idleGlow,
    angryProg,
    lHeight,
    lBottomR,
    lTilt,
    lOffsetY,
    rHeight,
    rBottomR,
    rTilt,
    rOffsetY,
    dotsOpacity,
    cheeksOpacity,
    cheeksScale,
    reactX,
    reactY,
  ]);

  // ── Animated styles ─────────────────────────────────────────────────────────

  const bodyStyle = useAnimatedStyle(() => {
    const shadowCol = interpolateColor(
      angryProg.value,
      [0, 1],
      [look.from, ANGRY_GLOW]
    );
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        // Combine breathing scale with reaction pop (per-axis).
        { scaleX: breathe.value * reactX.value },
        { scaleY: breathe.value * reactY.value },
      ],
      shadowColor: shadowCol,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4 + idleGlow.value * 0.35,
      shadowRadius: 16 + idleGlow.value * 12,
    };
  });

  const eyesContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: eye.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    // ringVisible gates overall visibility; ring drives the pulse opacity + scale.
    opacity: ringVisible.value * 0.55 * (1 - ring.value),
    transform: [{ scale: 0.7 + ring.value * 0.55 }],
  }));

  // Per-eye animated styles
  const lEyeStyle = useAnimatedStyle(() => ({
    height: lHeight.value,
    borderBottomLeftRadius: lBottomR.value,
    borderBottomRightRadius: lBottomR.value,
    marginBottom: lOffsetY.value,
    transform: [{ rotate: `${lTilt.value}deg` }],
  }));

  const rEyeStyle = useAnimatedStyle(() => ({
    height: rHeight.value,
    borderBottomLeftRadius: rBottomR.value,
    borderBottomRightRadius: rBottomR.value,
    marginBottom: rOffsetY.value,
    transform: [{ rotate: `${rTilt.value}deg` }],
  }));

  // Thinking dots — each dot has its own shared value for a visible cascade stagger
  const dotStyle0 = useAnimatedStyle(() => ({
    transform: [{ translateY: -4 * dot0.value }],
  }));
  const dotStyle1 = useAnimatedStyle(() => ({
    transform: [{ translateY: -4 * dot1.value }],
  }));
  const dotStyle2 = useAnimatedStyle(() => ({
    transform: [{ translateY: -4 * dot2.value }],
  }));
  const dotStyles = [dotStyle0, dotStyle1, dotStyle2];

  const dotsContainerStyle = useAnimatedStyle(() => ({
    opacity: dotsOpacity.value,
  }));

  const cheeksStyle = useAnimatedStyle(() => ({
    opacity: cheeksOpacity.value,
    transform: [{ scale: cheeksScale.value }],
  }));

  // ── Color crossfade: two stacked gradient ellipses ──────────────────────────
  // Base ellipse always shows look colors; red overlay fades in via angryProg.
  const angryOverlayStyle = useAnimatedStyle(() => ({
    opacity: angryProg.value,
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Listening pulse ring — always mounted, opacity driven by ring shared value */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: look.from,
          },
          ringStyle,
        ]}
      />

      {/* Body layer — carries breathe + reaction pop + shadow/glow */}
      <Animated.View
        style={[
          {
            width: size,
            height: size,
          },
          bodyStyle,
        ]}
      >
        {/* SVG body: two stacked ellipses for color crossfade.
            Base = look colors (always). Red overlay = angry prog opacity. */}
        <Svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Defs>
            <LinearGradient id="xavier-look" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={look.from} />
              <Stop offset="1" stopColor={look.to} />
            </LinearGradient>
          </Defs>
          {/* Base gradient (look colors) */}
          <Ellipse cx="50" cy="52" rx="45" ry="44" fill="url(#xavier-look)" />
          <Ellipse cx="38" cy="30" rx="20" ry="12" fill="#FFFFFF" opacity="0.16" />
        </Svg>

        {/* Angry red gradient overlay — fades in/out via angryProg */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, width: size, height: size },
            angryOverlayStyle,
          ]}
        >
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="xavier-angry" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={ANGRY_FROM} />
                <Stop offset="1" stopColor={ANGRY_TO} />
              </LinearGradient>
            </Defs>
            <Ellipse cx="50" cy="52" rx="45" ry="44" fill="url(#xavier-angry)" />
            {/* Keep the soft specular highlight in the angry state too. */}
            <Ellipse cx="38" cy="30" rx="20" ry="12" fill="#FFFFFF" opacity="0.16" />
          </Svg>
        </Animated.View>

        {/* Thinking dots — always rendered, opacity animated */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: size * 0.04,
              right: size * 0.1,
              flexDirection: 'row',
            },
            dotsContainerStyle,
          ]}
        >
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                {
                  width: size * 0.06,
                  height: size * 0.06,
                  borderRadius: size * 0.03,
                  backgroundColor: look.from,
                  marginLeft: i === 0 ? 0 : size * 0.03,
                },
                dotStyles[i],
              ]}
            />
          ))}
        </Animated.View>

        {/* Eyes — container handles blink (scaleY); per-eye handles geometry tweens */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: size * 0.38,
              left: 0,
              right: 0,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
            },
            eyesContainerStyle,
          ]}
        >
          {/* Left eye */}
          <Animated.View
            style={[
              {
                width: eyeW,
                backgroundColor: DARK,
                borderTopLeftRadius: eyeW,
                borderTopRightRadius: eyeW,
              },
              lEyeStyle,
            ]}
          />
          <View style={{ width: gap }} />
          {/* Right eye */}
          <Animated.View
            style={[
              {
                width: eyeW,
                backgroundColor: DARK,
                borderTopLeftRadius: eyeW,
                borderTopRightRadius: eyeW,
              },
              rEyeStyle,
            ]}
          />
        </Animated.View>

        {/* Cheeks — always rendered, fade + scale in on happy */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: size * 0.56,
              left: 0,
              right: 0,
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: size * 0.2,
            },
            cheeksStyle,
          ]}
        >
          <View
            style={{
              width: size * 0.1,
              height: size * 0.055,
              borderRadius: size * 0.05,
              backgroundColor: 'rgba(255,170,185,0.4)',
            }}
          />
          <View
            style={{
              width: size * 0.1,
              height: size * 0.055,
              borderRadius: size * 0.05,
              backgroundColor: 'rgba(255,170,185,0.4)',
            }}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
