/**
 * Welcome carousel (build 39) — an unmistakable first-run intro, replacing
 * the build-38 in-chat guided tutorial (src/domain/onboarding.ts, deleted).
 * That flow blended into the real app and created REAL data mid-tutorial;
 * this screen is a dedicated full-screen route shown ABOVE the tabs, creates
 * ZERO accounts/transactions, and only ever writes the `onboarding_complete`
 * flag on the way out.
 *
 * Shown from two places:
 *  - The assistant tab's first-run check (app/(tabs)/index.tsx), once per
 *    session, when the flag is unset AND there are no accounts yet.
 *  - Settings → "Replay tutorial" (app/(tabs)/settings.tsx), which pushes
 *    straight here — a direct route push re-mounts this screen fresh every
 *    time, so replaying twice in a session just works (no one-shot ref to
 *    go stale).
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssistantAvatar } from '../src/components/AssistantAvatar';
import { Button } from '../src/components/ui/Button';
import { useThemeColors } from '../src/theme/useThemeColors';
import { useScaledType } from '../src/theme/useScaledType';
import { setOnboardingComplete } from '../src/features/settings/repository';
import { ONBOARDING_CARDS, OnboardingCardVisual } from '../src/domain/onboardingCards';

/** How far past the last card's resting offset the native scroll bounce has
 *  to travel before it counts as "swiped past the end" (spec: that's
 *  equivalent to tapping Get Started). Small enough to catch a deliberate
 *  extra swipe, large enough that the bounce's own rubber-banding on a
 *  normal arrival at the last card doesn't fire it by accident. */
const OVERSCROLL_FINISH_PX = 50;

export default function WelcomeScreen() {
  const c = useThemeColors();
  const s = useScaledType();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const [pageIndex, setPageIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const pageIndexRef = useRef(0);
  const finishedRef = useRef(false);
  const lastIndex = ONBOARDING_CARDS.length - 1;

  // Skip and Get Started both just set the flag and leave — this screen
  // creates no accounts/transactions/settings beyond that one write.
  // router.replace (not push) so the carousel never sits in the back stack;
  // there's nothing to "go back" to once it's dismissed.
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    await setOnboardingComplete(true);
    router.replace('/');
  }, [router]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.min(lastIndex, Math.max(0, Math.round(x / width)));
      if (idx !== pageIndexRef.current) {
        pageIndexRef.current = idx;
        setPageIndex(idx);
      }
      // Swiping past the end == Get Started: only once already resting on
      // the last card does further overscroll (the native bounce) finish.
      const maxOffset = lastIndex * width;
      if (pageIndexRef.current === lastIndex && x > maxOffset + OVERSCROLL_FINISH_PX) {
        void finish();
      }
    },
    [finish, lastIndex, width]
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Full-screen modal presentation + no swipe-back: the ONLY ways off
          this screen are Skip / Get Started / overscroll-past-end, all of
          which route through finish() and write the flag. Without this, an
          iOS edge-swipe could pop the route and leave onboarding_complete
          unset (harmless — it just re-shows next time — but it'd also drop
          the user back into a half-dismissed state instead of the normal
          app). */}
      <Stack.Screen
        options={{
          presentation: 'fullScreenModal',
          gestureEnabled: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Animated.ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false, listener: handleScroll }
        )}
        scrollEventThrottle={16}
      >
        {ONBOARDING_CARDS.map((card, i) => (
          <CarouselCard
            key={card.title}
            title={card.title}
            body={card.body}
            visual={card.visual}
            index={i}
            width={width}
            scrollX={scrollX}
            reducedMotion={reducedMotion}
            insets={insets}
          />
        ))}
      </Animated.ScrollView>

      {/* Persistent Skip — visible on every card, top-right. */}
      <Pressable
        onPress={finish}
        accessibilityLabel="Skip"
        accessibilityRole="button"
        style={{
          position: 'absolute',
          top: insets.top + 12,
          right: 20,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text className="text-muted font-bold" style={{ fontSize: s.role.control }}>
          Skip
        </Text>
      </Pressable>

      {/* Page indicator + Get Started (last card only). */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 24,
          alignItems: 'center',
        }}
      >
        <View className="flex-row items-center justify-center mb-5" style={{ gap: 8 }}>
          {ONBOARDING_CARDS.map((card, i) => (
            <View
              key={card.title}
              className={`rounded-pill ${i === pageIndex ? 'bg-primary' : 'bg-surfaceAlt'}`}
              style={{ width: s.dot, height: s.dot }}
            />
          ))}
        </View>
        {pageIndex === lastIndex && (
          <Button
            title="Get Started"
            onPress={finish}
            accessibilityLabel="Get Started"
            className="px-10"
          />
        )}
      </View>
    </View>
  );
}

function CarouselCard({
  title,
  body,
  visual,
  index,
  width,
  scrollX,
  reducedMotion,
  insets,
}: {
  title: string;
  body: string;
  visual: OnboardingCardVisual;
  index: number;
  width: number;
  scrollX: Animated.Value;
  reducedMotion: boolean;
  insets: { top: number; bottom: number };
}) {
  const c = useThemeColors();
  const s = useScaledType();

  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  // A subtle fade+scale as each card becomes active — skipped entirely
  // (static, fully opaque) when the OS "Reduce Motion" setting is on.
  const opacity = reducedMotion
    ? 1
    : scrollX.interpolate({ inputRange, outputRange: [0.4, 1, 0.4], extrapolate: 'clamp' });
  const scale = reducedMotion
    ? 1
    : scrollX.interpolate({ inputRange, outputRange: [0.92, 1, 0.92], extrapolate: 'clamp' });

  return (
    <View style={{ width, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120 }}>
      <Animated.View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
          opacity,
          transform: [{ scale }],
        }}
      >
        <CardVisual visual={visual} c={c} />
        <Text
          className="text-text text-center font-extrabold mt-8"
          style={{ fontSize: s.role.screenTitle, lineHeight: Math.round(s.role.screenTitle * 1.25) }}
        >
          {title}
        </Text>
        <Text
          className="text-muted text-center mt-4"
          style={{ fontSize: s.role.body, lineHeight: Math.round(s.role.body * 1.4), maxWidth: 320 }}
        >
          {body}
        </Text>
      </Animated.View>
    </View>
  );
}

/** Maps each card's visual key to an actual component — the Xavier avatar
 *  for the intro card, a themed Feather icon circle for the rest. Keeps
 *  src/domain/onboardingCards.ts itself framework-free. */
function CardVisual({
  visual,
  c,
}: {
  visual: OnboardingCardVisual;
  c: ReturnType<typeof useThemeColors>;
}) {
  if (visual === 'xavier') {
    return <AssistantAvatar size={140} state="happy" />;
  }
  const icon =
    visual === 'privacy' ? 'lock' : visual === 'glance' ? 'bar-chart-2' : 'check-circle';
  return (
    <View
      className="bg-surfaceAlt items-center justify-center"
      style={{ width: 140, height: 140, borderRadius: 70 }}
    >
      <Feather name={icon} size={56} color={c.primary} />
    </View>
  );
}
