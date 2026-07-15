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
import { indexFromOffset, shouldFinishFromOverscroll } from '../src/domain/onboardingCarousel';

/** How far past the last card's resting offset the native scroll bounce has
 *  to travel before it counts as "swiped past the end" (spec: that's
 *  equivalent to tapping Get Started). Small enough to catch a deliberate
 *  extra swipe, large enough that the bounce's own rubber-banding on a
 *  normal arrival at the last card doesn't fire it by accident. */
const OVERSCROLL_FINISH_PX = 50;

/** Below this `|velocity.x|` (points/ms), a drag-release counts as a
 *  no-flick "dead stop" rather than a fling — see `handleScrollEndDrag`.
 *  `velocity` is undefined on some paths (treated as 0, i.e. also a
 *  dead-stop) rather than a fling, since assuming "no update needed" would
 *  be the unsafe direction to guess wrong in. */
const NO_FLICK_VELOCITY_EPSILON = 0.05;

export default function WelcomeScreen() {
  const c = useThemeColors();
  const s = useScaledType();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
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

  // The Animated.event driving scrollX must be a stable reference (created
  // once, not on every render) — recreating it mid-gesture is exactly what
  // interrupted native paging and caused the build-39 "snaps back to card 1"
  // bug. It carries no listener: nothing in the per-frame scroll path calls
  // setState, only this ref-backed Animated.Value (native-driver-friendly,
  // no re-render) that feeds each card's fade/scale.
  const onScroll = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
      useNativeDriver: false,
    })
  ).current;

  // Page index (dots + "Get Started" visibility) and the overscroll-finish
  // check both come from scroll-END events only — never from onScroll. A
  // pre-layout frame (width still 0) is guarded out via indexFromOffset /
  // shouldFinishFromOverscroll so it can't land on the wrong page or fire
  // finish() spuriously.
  const updatePageIndex = useCallback(
    (x: number) => {
      const idx = indexFromOffset(x, width, ONBOARDING_CARDS.length);
      if (idx !== pageIndexRef.current) {
        pageIndexRef.current = idx;
        setPageIndex(idx);
      }
    },
    [width]
  );

  const checkOverscrollFinish = useCallback(
    (x: number) => {
      if (shouldFinishFromOverscroll(x, width, lastIndex, OVERSCROLL_FINISH_PX)) {
        void finish();
      }
    },
    [finish, lastIndex, width]
  );

  // Fires once the native paging snap has settled — the authoritative
  // resting page index.
  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      updatePageIndex(x);
      checkOverscrollFinish(x);
    },
    [updatePageIndex, checkOverscrollFinish]
  );

  // Fires the instant the finger lifts, which is when a deliberate overscroll
  // past the last card is still visible in `contentOffset.x` — by the time
  // momentum settles, the bounce has already snapped back to the last page's
  // resting offset, so this is the only reliable place to catch it.
  //
  // It's ALSO the velocity-gated fallback for the page index: iOS is
  // documented to sometimes skip `scrollViewDidEndDecelerating`
  // (onMomentumScrollEnd) on a pagingEnabled ScrollView when the drag ends
  // with ~0 residual velocity right at a page boundary — a slow, deliberate
  // swipe with no flick. Left solely to onMomentumScrollEnd, that no-flick
  // case would never call updatePageIndex, freezing the dots (and "Get
  // Started") on the previous card. So: near-zero velocity here means this
  // IS the settle, and we derive the index from this drag-end offset too.
  // A real flick (non-zero velocity) skips this — onMomentumScrollEnd owns
  // it, so we don't set an intermediate index mid-fling. updatePageIndex is
  // idempotent, so the rare case where both fire is harmless.
  const handleScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const velocityX = e.nativeEvent.velocity?.x ?? 0;
      if (Math.abs(velocityX) < NO_FLICK_VELOCITY_EPSILON) {
        updatePageIndex(x);
      }
      checkOverscrollFinish(x);
    },
    [updatePageIndex, checkOverscrollFinish]
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
        style={{ flex: 1 }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
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
            height={height}
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
  height,
  scrollX,
  reducedMotion,
  insets,
}: {
  title: string;
  body: string;
  visual: OnboardingCardVisual;
  index: number;
  width: number;
  height: number;
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
    // Explicit width AND height (not `flex: 1`, which can't resolve without
    // an ancestor with a resolved height inside a horizontal ScrollView's
    // content container) — this is what makes pagingEnabled snap against a
    // viewport that actually matches each card's width, and lets the
    // Animated.View below center its content vertically instead of sitting
    // top-weighted in a collapsed-height row.
    <View
      style={{
        width,
        height,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 120,
      }}
    >
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
