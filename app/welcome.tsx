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
 *
 * Paging model (build 40 rewrite): a PLAIN `ScrollView horizontal
 * pagingEnabled`, exactly like the app's own working chart carousel
 * (app/(tabs)/dashboard.tsx). The build-39 version used an `Animated.ScrollView`
 * with a `scrollX` `Animated.event` driving a per-card opacity/scale fade — that
 * fade both greyed out the neighbouring cards AND fought the native paging, so
 * on device it wouldn't swipe past the first card. All of that is gone here:
 * cards are full-opacity, the page index comes from `onMomentumScrollEnd` only,
 * and paging between cards IS the effect.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
import {
  computeOnboardingChromeReserves,
  computeOnboardingVisualSize,
} from '../src/domain/onboardingChrome';

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

  const [pageIndex, setPageIndex] = useState(0);
  const finishedRef = useRef(false);
  const lastIndex = ONBOARDING_CARDS.length - 1;

  // Real reserved space for the chrome drawn on top of the pager (Skip;
  // dots + Get Started) — computed from the actual scaled sizes those
  // pieces render at, not a hard-coded guess, so a card's content can never
  // sit under them at any font scale or safe-area inset. Same reserves on
  // every card (not just the last, which is the only one showing "Get
  // Started") so paging doesn't change a card's own vertical centring.
  const chromeReserves = computeOnboardingChromeReserves({
    insetsTop: insets.top,
    insetsBottom: insets.bottom,
    skipFontSize: s.role.control,
    dotSize: s.dot,
    fontScale: s.fontScale,
  });
  // The fixed 140pt visual shrinks as Dynamic Type climbs, freeing up space
  // the growing title/body need instead of crowding them out.
  const visualSize = computeOnboardingVisualSize(s.fontScale);

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

  // The authoritative resting page index, taken from the native paging snap —
  // the same pattern as the dashboard chart carousel. `indexFromOffset` guards
  // a pre-layout frame (width still 0) so it can't divide-by-zero onto the
  // wrong card.
  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      setPageIndex(indexFromOffset(x, width, ONBOARDING_CARDS.length));
    },
    [width]
  );

  // A deliberate swipe past the last card counts as Get Started. Caught on
  // drag-release (not momentum-end): by the time the bounce settles it has
  // already snapped back to the last page's resting offset, so this is the
  // only place the overscroll is still visible in `contentOffset.x`.
  const handleScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      if (shouldFinishFromOverscroll(x, width, lastIndex, OVERSCROLL_FINISH_PX)) {
        void finish();
      }
    },
    [finish, lastIndex, width]
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* No swipe-back gesture: the ONLY ways off this screen are Skip / Get
          Started / overscroll-past-end, all of which route through finish()
          and write the flag. `presentation` is left default (a normal
          full-screen route) — the build-39 `fullScreenModal` presentation was
          one more thing wrapping the ScrollView, and a plain route swipes just
          as cleanly. */}
      <Stack.Screen options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
      <ScrollView
        style={{ flex: 1 }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
      >
        {ONBOARDING_CARDS.map((card) => (
          <CarouselCard
            key={card.title}
            title={card.title}
            body={card.body}
            visual={card.visual}
            width={width}
            topReserve={chromeReserves.topReserve}
            bottomReserve={chromeReserves.bottomReserve}
            visualSize={visualSize}
          />
        ))}
      </ScrollView>

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
              className={`rounded-pill ${i === pageIndex ? 'bg-primaryFill' : 'bg-surfaceAlt'}`}
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
  width,
  topReserve,
  bottomReserve,
  visualSize,
}: {
  title: string;
  body: string;
  visual: OnboardingCardVisual;
  width: number;
  topReserve: number;
  bottomReserve: number;
  visualSize: number;
}) {
  const c = useThemeColors();
  const s = useScaledType();

  // Width === the ScrollView viewport width so pagingEnabled snaps cleanly
  // (exactly like dashboard's `<View style={{ width: slideWidth }}>` slides).
  // NO explicit height: inside a horizontal ScrollView the content container is
  // a full-height flex row, so this card stretches to the viewport height on
  // its own.
  //
  // The card itself is now a nested vertical `ScrollView` (not a plain
  // `View`): at large Dynamic Type the visual + title + body can exceed the
  // viewport height, and a plain View with `justifyContent: 'center'` simply
  // clips whatever doesn't fit (build-39/40's bug — the body ran under the
  // dots row with no way to reach the rest of it). `contentContainerStyle`
  // still centres the content with `flexGrow: 1, justifyContent: 'center'`
  // when it DOES fit, and lets it scroll when it doesn't. This nested
  // ScrollView scrolls on a different axis (vertical) than the outer pager
  // (horizontal `pagingEnabled`), so it doesn't intercept the outer pager's
  // horizontal pan gesture or its `onMomentumScrollEnd`/`onScrollEndDrag`
  // (those fire on the OUTER ScrollView's own native scroll view, which this
  // nested one doesn't wrap or proxy) — RN/iOS route a gesture to whichever
  // ScrollView's pan axis matches the touch, so a vertical drag scrolls this
  // inner view and a horizontal drag pages the outer one.
  //
  // `topReserve`/`bottomReserve` (src/domain/onboardingChrome.ts) replace the
  // old hard-coded `insets.top + 24` / `insets.bottom + 120` guesses — they're
  // derived from the Skip button's and the dots-row/Get-Started button's
  // ACTUAL scaled sizes, so content can never render under that chrome at
  // any font scale.
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingTop: topReserve,
        paddingBottom: bottomReserve,
      }}
      showsVerticalScrollIndicator={false}
    >
      <CardVisual visual={visual} c={c} size={visualSize} />
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
    </ScrollView>
  );
}

/** Maps each card's visual key to an actual component — the Xavier avatar
 *  for the intro card, a themed Feather icon circle for the rest. Keeps
 *  src/domain/onboardingCards.ts itself framework-free.
 *
 *  `size` (src/domain/onboardingChrome.ts's `computeOnboardingVisualSize`)
 *  replaces the old fixed 140 — it shrinks as Dynamic Type climbs so the
 *  visual stops eating the space the growing title/body need. The icon
 *  circle's `borderRadius` and the Feather icon's own size stay in the same
 *  proportion to it as the original 140/70/56 (radius = size / 2, icon =
 *  size × (56 / 140)) so the icon doesn't look cramped or lost inside the
 *  circle at any scale. */
function CardVisual({
  visual,
  c,
  size,
}: {
  visual: OnboardingCardVisual;
  c: ReturnType<typeof useThemeColors>;
  size: number;
}) {
  if (visual === 'xavier') {
    return <AssistantAvatar size={size} state="happy" />;
  }
  const icon =
    visual === 'privacy'
      ? 'lock'
      : visual === 'glance'
        ? 'bar-chart-2'
        : visual === 'ask'
          ? 'pie-chart'
          : visual === 'byok'
            ? 'key'
            : 'check-circle';
  return (
    <View
      className="bg-surfaceAlt items-center justify-center"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Feather name={icon} size={Math.round(size * (56 / 140))} color={c.primary} />
    </View>
  );
}
