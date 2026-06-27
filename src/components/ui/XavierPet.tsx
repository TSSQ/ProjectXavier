/**
 * Xavier — the assistant's animated "pet" avatar. An SVG gradient blob that is
 * always subtly alive (breathing + blinking) and reacts to the assistant state:
 *   idle · listening · thinking · happy · confused · angry
 * Motion is driven by Reanimated; no native build needed beyond the libraries
 * already in the project (react-native-reanimated, react-native-svg).
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Ellipse } from 'react-native-svg';
import { AvatarState, AvatarLook, lookById } from '../../domain/avatar';

const DARK = '#0E1116';

export function XavierPet({
  size = 96,
  state = 'idle',
  look = lookById('xavier'),
}: {
  size?: number;
  state?: AvatarState;
  look?: AvatarLook;
}) {
  const accent = look.from;
  const scale = useSharedValue(1);
  const ty = useSharedValue(0);
  const tx = useSharedValue(0);
  const rot = useSharedValue(0);
  const eye = useSharedValue(1); // eye scaleY (blink)
  const ring = useSharedValue(0); // listening pulse 0..1
  const dot = useSharedValue(0); // thinking dots bob 0..1

  // Red flash overlay opacity for angry state (0..1).
  const redFlash = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(scale);
    cancelAnimation(ty);
    cancelAnimation(tx);
    cancelAnimation(rot);
    cancelAnimation(eye);
    cancelAnimation(ring);
    cancelAnimation(dot);
    cancelAnimation(redFlash);

    const breatheMs = state === 'listening' ? 1500 : 1900;
    const ease = Easing.inOut(Easing.quad);
    scale.value = withRepeat(withTiming(1.045, { duration: breatheMs, easing: ease }), -1, true);

    // vertical motion: a playful hop when happy, otherwise a gentle bob
    if (state === 'happy') {
      ty.value = withRepeat(
        withSequence(
          withTiming(-20, { duration: 300, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 520, easing: Easing.bounce })
        ),
        -1
      );
    } else {
      ty.value = withRepeat(withTiming(-8, { duration: breatheMs, easing: ease }), -1, true);
    }

    rot.value = state === 'thinking'
      ? withRepeat(withTiming(-6, { duration: 1200, easing: ease }), -1, true)
      : withTiming(0, { duration: 200 });

    if (state === 'angry') {
      // Sharper, faster shake than confused.
      tx.value = withRepeat(
        withSequence(
          withTiming(-10, { duration: 45 }),
          withTiming(10, { duration: 45 }),
          withTiming(-7, { duration: 45 }),
          withTiming(7, { duration: 45 }),
          withTiming(0, { duration: 45 })
        ),
        -1
      );
    } else if (state === 'confused') {
      tx.value = withRepeat(
        withSequence(
          withTiming(-8, { duration: 80 }),
          withTiming(8, { duration: 80 }),
          withTiming(-5, { duration: 80 }),
          withTiming(0, { duration: 80 })
        ),
        -1
      );
    } else {
      tx.value = withTiming(0, { duration: 150 });
    }

    ring.value = state === 'listening'
      ? withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false)
      : withTiming(0, { duration: 150 });

    dot.value = state === 'thinking'
      ? withRepeat(withTiming(1, { duration: 500, easing: ease }), -1, true)
      : 0;

    if (state === 'idle' || state === 'listening') {
      const gap = state === 'listening' ? 3000 : 4200;
      eye.value = withRepeat(
        withSequence(
          withTiming(1, { duration: gap }),
          withTiming(0.1, { duration: 80 }),
          withTiming(1, { duration: 80 })
        ),
        -1
      );
    } else {
      eye.value = withTiming(1, { duration: 150 });
    }

    // Brief red flash for angry state.
    if (state === 'angry') {
      redFlash.value = withRepeat(
        withSequence(
          withTiming(0.18, { duration: 200 }),
          withTiming(0.05, { duration: 400 })
        ),
        -1,
        true
      );
    } else {
      redFlash.value = withTiming(0, { duration: 200 });
    }
  }, [state, scale, ty, tx, rot, eye, ring, dot, redFlash]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
      { rotate: `${rot.value}deg` },
    ],
  }));
  const eyesStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: eye.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - ring.value),
    transform: [{ scale: 0.7 + ring.value * 0.55 }],
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * dot.value }] }));
  const redFlashStyle = useAnimatedStyle(() => ({ opacity: redFlash.value }));

  // expression geometry (fractions of size)
  const eyeW = size * 0.13;
  const eyeH = (state === 'thinking' || state === 'angry') ? size * 0.07 : size * 0.17;
  const gap = size * 0.12;

  // Angry recolours the body red (same gradient shape), and tints the glow.
  const bodyFrom = state === 'angry' ? '#F4707E' : look.from;
  const bodyTo = state === 'angry' ? '#C4302E' : look.to;
  const glow = state === 'angry' ? '#C4302E' : accent;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {state === 'listening' && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: 2,
              borderColor: accent,
            },
            ringStyle,
          ]}
        />
      )}

      <Animated.View
        style={[
          {
            width: size,
            height: size,
            shadowColor: glow,
            shadowOpacity: 0.45,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
          },
          bodyStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="xavier" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={bodyFrom} />
              <Stop offset="1" stopColor={bodyTo} />
            </LinearGradient>
          </Defs>
          <Ellipse cx="50" cy="52" rx="45" ry="44" fill="url(#xavier)" />
          <Ellipse cx="38" cy="30" rx="20" ry="12" fill="#FFFFFF" opacity="0.16" />
        </Svg>

        {/* thinking dots */}
        {state === 'thinking' && (
          <View
            style={{
              position: 'absolute',
              top: size * 0.04,
              right: size * 0.1,
              flexDirection: 'row',
            }}
          >
            {[0, 1, 2].map((i) => (
              <Animated.View
                key={i}
                style={[
                  {
                    width: size * 0.06,
                    height: size * 0.06,
                    borderRadius: size * 0.03,
                    backgroundColor: accent,
                    marginLeft: i === 0 ? 0 : size * 0.03,
                  },
                  dotStyle,
                ]}
              />
            ))}
          </View>
        )}

        {/* eyes */}
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
            eyesStyle,
          ]}
        >
          <Eye state={state} side="l" w={eyeW} h={eyeH} />
          <View style={{ width: gap }} />
          <Eye state={state} side="r" w={eyeW} h={eyeH} />
        </Animated.View>

        {/* cheeks (happy) */}
        {state === 'happy' && (
          <>
            <Cheek style={{ left: size * 0.2 }} size={size} />
            <Cheek style={{ right: size * 0.2 }} size={size} />
          </>
        )}

        {/* mouth */}
        {state === 'happy' && (
          <View
            style={{
              position: 'absolute',
              top: size * 0.6,
              alignSelf: 'center',
              width: size * 0.18,
              height: size * 0.09,
              borderColor: DARK,
              borderBottomWidth: 3,
              borderLeftWidth: 3,
              borderRightWidth: 3,
              borderBottomLeftRadius: size * 0.1,
              borderBottomRightRadius: size * 0.1,
            }}
          />
        )}
        {state === 'confused' && (
          <View
            style={{
              position: 'absolute',
              top: size * 0.64,
              alignSelf: 'center',
              width: size * 0.14,
              height: 3,
              borderRadius: 2,
              backgroundColor: DARK,
            }}
          />
        )}

        {/* angry: frown (mirror of happy mouth — top arc instead of bottom) */}
        {state === 'angry' && (
          <View
            style={{
              position: 'absolute',
              top: size * 0.62,
              alignSelf: 'center',
              width: size * 0.18,
              height: size * 0.09,
              borderColor: DARK,
              borderTopWidth: 3,
              borderLeftWidth: 3,
              borderRightWidth: 3,
              borderTopLeftRadius: size * 0.1,
              borderTopRightRadius: size * 0.1,
            }}
          />
        )}

        {/* angry: slanted brows — two dark bars angled inward-down */}
        {state === 'angry' && (
          <>
            <View
              style={{
                position: 'absolute',
                top: size * 0.28,
                left: size * 0.24,
                width: size * 0.16,
                height: 3,
                backgroundColor: DARK,
                borderRadius: 2,
                transform: [{ rotate: '20deg' }],
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: size * 0.28,
                right: size * 0.24,
                width: size * 0.16,
                height: 3,
                backgroundColor: DARK,
                borderRadius: 2,
                transform: [{ rotate: '-20deg' }],
              }}
            />
          </>
        )}

        {/* angry: brief reddish flash overlay */}
        {state === 'angry' && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: '#F2637E',
              },
              redFlashStyle,
            ]}
          />
        )}
      </Animated.View>
    </View>
  );
}

function Eye({
  state,
  side,
  w,
  h,
}: {
  state: AvatarState;
  side: 'l' | 'r';
  w: number;
  h: number;
}) {
  // happy → upward arc (^), confused → right eye smaller/raised, angry → narrow
  // oval, else standard oval
  if (state === 'happy') {
    return (
      <View
        style={{
          width: w,
          height: w * 0.55,
          borderTopLeftRadius: w,
          borderTopRightRadius: w,
          backgroundColor: DARK,
        }}
      />
    );
  }
  if (state === 'angry') {
    // Narrowed: half-height oval, centred
    return (
      <View
        style={{
          width: w,
          height: h,
          borderRadius: w,
          backgroundColor: DARK,
        }}
      />
    );
  }
  const small = state === 'confused' && side === 'r';
  return (
    <View
      style={{
        width: w,
        height: small ? h * 0.6 : h,
        borderRadius: w,
        backgroundColor: DARK,
        marginBottom: small ? h * 0.4 : 0,
      }}
    />
  );
}

function Cheek({ style, size }: { style: object; size: number }) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          top: size * 0.56,
          width: size * 0.1,
          height: size * 0.055,
          borderRadius: size * 0.05,
          backgroundColor: 'rgba(242,99,126,0.5)',
        },
        style,
      ]}
    />
  );
}
