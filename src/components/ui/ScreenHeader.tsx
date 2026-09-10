/**
 * ScreenHeader — the sticky glass header shared by Dashboard and Transactions
 * (glass-chrome-adoption-spec.md D2). Carries the screen title and a single
 * `PeriodPill`, retiring the two hand-rolled period-pill copies those screens
 * used to keep separately (Redline C4).
 *
 * Positioned absolutely at the top of the screen so content scrolls UNDER
 * the glass and refracts through it — the caller measures the header's laid
 * -out height via `onHeight` and applies it as the scroll view's own
 * `paddingTop` (mockup note 2/3). That padding is static (it only changes
 * when `onHeight` reports a genuinely different measured height), so the
 * hide-on-scroll slide below — driven by a SEPARATE animated offset — never
 * shifts content: the header floats over already-padded space, it doesn't
 * reserve less of it when it slides away.
 *
 * Renders on `sheer` (transparent-hiding-header-spec.md), not `chrome`: this
 * is the one bar that sits directly over a full-bleed `DepthField` with
 * nothing else behind it, so it needs a much lighter tint for the gradient
 * to read through, and no `edge` hairline on the glass tier (the opaque-tier
 * fallback below keeps its fill and edge, same as before).
 *
 * ── Hide-on-scroll and the R9 hazard ────────────────────────────────────
 * `useScreenHeaderScroll` below wraps this header's OWN outer container in
 * an `Animated.View` driven by `useAnimatedStyle` (fed from a shared value
 * an ordinary JS-thread `onScroll` callback writes to — see that hook's own
 * comment for why this isn't a `useAnimatedScrollHandler` worklet), which
 * looks exactly like the wrapper the file used to warn against. It is
 * safe here for a reason specific to THIS transform, not a blanket
 * reversal of that warning:
 *
 *   R9 (Glass.tsx, glassMountGate.ts) is about an `entering` layout
 *   animation intercepting a nested GlassView's FIRST `layoutSubviews` —
 *   the native effect is assigned exactly once, on that first layout, and
 *   is lost for good if that layout lands mid-animation. A `translateY`
 *   driven by `useAnimatedStyle` is not a layout animation at all: it's a
 *   paint-time transform Reanimated applies as an ordinary prop mutation on
 *   the UI thread. It never touches Yoga's box model (width/height/position
 *   in the layout tree are unchanged — only the render transform moves), so
 *   it can't defer or reorder the nested Glass's `layoutSubviews` call, and
 *   nothing here uses `entering`/`exiting` at all. Just as important: the
 *   shared value this style reads starts at `0` (fully shown), so the
 *   header's actual first layout — the one `mayMountGlass`/Glass.tsx care
 *   about — happens completely at rest, with no motion in flight, exactly
 *   as before this change. Once mounted, the whole subtree (material
 *   included) moves as one composited layer when the offset animates,
 *   the same way a `UIVisualEffectView` keeps blurring correctly while its
 *   own layer is being moved or scrolled.
 *
 * Still true: do NOT add `entering`/`exiting` to this wrapper. That is the
 * actual R9 hazard, and nothing above licenses it.
 */
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated, {
  AnimatedStyle,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { useGlass } from '../../theme/useGlass';
import { settleMeasuredHeight } from '../../domain/layoutSettle';
import { mayMountGlass } from '../../domain/glassMountGate';
import { nextHeaderOffset } from '../../domain/headerScrollOffset';
import { useThemeColors } from '../../theme/useThemeColors';
import { radius } from '../../theme/tokens';

/** Height of the header's own content below the status bar at the default
 *  text size (8 top + ~44 title row + 10 bottom). Screens seed their scroll
 *  padding with `insets.top + SCREEN_HEADER_ESTIMATE` so the first frame —
 *  before `onHeight` has reported the measured value — already clears the
 *  bar instead of starting from 0 and snapping. */
export const SCREEN_HEADER_ESTIMATE = 62;

export interface ScreenHeaderScroll {
  /** Drives the header's slide — pass straight through to `scroll` below. */
  style: AnimatedStyle<ViewStyle>;
  /** True once the header is fully off-screen. Flips ScreenHeader's
   *  pointerEvents/accessibility so a hidden header can't eat a touch or be
   *  reached by VoiceOver. */
  hidden: boolean;
}

export interface UseScreenHeaderScrollOptions {
  /** The header's own measured height (the screen's `onHeight` value) —
   *  the offset's upper clamp. */
  headerHeight: number;
  /** True while something the header owns must stay reachable regardless of
   *  scroll — Transactions' open, focused search field. Forces fully shown.
   *  Default false (Dashboard has nothing that needs this). */
  locked?: boolean;
}

/**
 * Drives ScreenHeader's hide-on-scroll-down / reveal-on-scroll-up slide.
 * One call per screen: attach the returned `onScroll` to the screen's own
 * (plain — see below) `ScrollView`/`SectionList`, and pass `scroll={{ style,
 * hidden }}` to `<ScreenHeader>`. Keeping this here, rather than duplicated
 * inline in Dashboard and Transactions, is what keeps the actual DECISION
 * (`nextHeaderOffset`, in src/domain) the only place either screen's
 * hide-on-scroll behaviour is expressed.
 *
 * `onScroll` is an ORDINARY (non-worklet) JS-thread callback, not a
 * `useAnimatedScrollHandler` result — confirmed necessary on a real
 * simulator, not assumed: device testing (see
 * transparent-hiding-header-spec.md "Why onScroll is a plain callback")
 * found that `useAnimatedScrollHandler`'s native event registration never
 * fires in this build at all — a *minimal*, inline, nothing-but-`runOnJS`
 * handler passed directly to `useAnimatedScrollHandler` on both
 * `Animated.ScrollView` and a `createAnimatedComponent`-wrapped
 * `SectionList` never ran, on either screen, even under a confirmed real
 * scroll (list content visibly moved; a PLAIN `onScroll` callback on the
 * exact same `Animated.ScrollView` fired correctly). Since a plain callback
 * is all this needs, Dashboard and Transactions use the PLAIN RN
 * `ScrollView`/`SectionList` — the Animated-wrapped versions were only ever
 * needed for a worklet handler, which this isn't.
 *
 * `useAnimatedStyle` and `useAnimatedReaction` are a different Reanimated
 * code path (a shared-value reaction, not a native event-handler
 * registration) and are unaffected — both are exercised elsewhere in this
 * app (BottomSheet's keyboard lift) — so the shared value this callback
 * writes still drives the slide correctly; only the EVENT SOURCE moved off
 * the broken path.
 *
 * Cost of this fallback: one JS-thread round trip per (throttled, 16ms)
 * scroll event, instead of a pure UI-thread worklet. It does NOT cost a
 * React re-render: this callback only ever writes a shared value
 * (`offset.value = …`), never calls `setState` — the one piece of ordinary
 * React state here, `hidden`, still only updates on the rare frame the
 * offset actually crosses the header's height (via `useAnimatedReaction` +
 * `runOnJS`, on the UI thread), not once per scroll frame.
 */
export function useScreenHeaderScroll({
  headerHeight,
  locked = false,
}: UseScreenHeaderScrollOptions): ScreenHeaderScroll & {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const offset = useSharedValue(0);
  // `previousY` is a plain ref — only ever read/written from the JS thread,
  // inside `onScroll` below. `heightShared`/`lockedShared` stay SHARED
  // VALUES rather than refs, even though `onScroll` now runs on the JS
  // thread too: `useAnimatedReaction` below still reads `heightShared` from
  // its UI-thread worklet, and a plain ref's `.current` isn't a safe read
  // from there (only a shared value's `.value` is, from either thread).
  const previousY = useRef(0);
  const heightShared = useSharedValue(headerHeight);
  const lockedShared = useSharedValue(locked);

  useEffect(() => {
    heightShared.value = headerHeight;
  }, [headerHeight, heightShared]);
  useEffect(() => {
    lockedShared.value = locked;
  }, [locked, lockedShared]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    offset.value = nextHeaderOffset({
      offset: offset.value,
      previousY: previousY.current,
      y,
      headerHeight: heightShared.value,
      locked: lockedShared.value,
    });
    previousY.current = y;
  };

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -offset.value }],
  }));

  const [hidden, setHidden] = useState(false);
  useAnimatedReaction(
    () => offset.value >= heightShared.value,
    (isHidden, wasHidden) => {
      if (isHidden !== wasHidden) runOnJS(setHidden)(isHidden);
    }
  );

  return { onScroll, style, hidden };
}

export interface ScreenHeaderProps {
  title: string;
  period: { label: string; onPress: () => void };
  /** Transactions' search button; absent on Dashboard. */
  right?: ReactNode;
  /** Transactions' open search field, rendered under the title row. */
  below?: ReactNode;
  /** The header's own laid-out height, so the screen can pad its scroll
   *  content to clear it. */
  onHeight: (height: number) => void;
  /** From `useScreenHeaderScroll` — drives the hide-on-scroll slide. */
  scroll: ScreenHeaderScroll;
}

export function ScreenHeader({ title, period, right, below, onHeight, scroll }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const { tier, tokens } = useGlass();
  // The content's own measured height. Glass (below) is a childless sibling
  // sized off this number and KEYED on it, so any height change — the search
  // field appearing, a wrapped title at large Dynamic Type, a long period
  // label — mounts a fresh GlassView already at its final size. That matters
  // because expo-glass-effect applies its native effect exactly once, on the
  // GlassView's first layoutSubviews (Glass.tsx header comment): resizing an
  // existing instance leaves the grown area unblurred. Keying the content
  // itself would remount the search TextInput and drop focus, so the content
  // stays put and only the material behind it is replaced.
  // Known cost: when the content grows (search opens) it lays out taller a
  // frame or two before the new Glass mounts, so a thin band under the field
  // is briefly unblurred — the field's own solid fill hides most of it, and an
  // opaque wrapper would defeat the material, so this is accepted, not fixed.
  const [height, setHeight] = useState<number | null>(null);
  // No `entered` — this header mounts with the screen, no Reanimated
  // `entering` ancestor to wait for (see the file header above and
  // glassMountGate.ts), so the shared predicate only needs `measured`.
  const showGlass = mayMountGlass({ tier, measured: height });

  const handleLayout = (e: LayoutChangeEvent) => {
    const h = settleMeasuredHeight(e.nativeEvent.layout.height);
    setHeight(h);
    onHeight(h);
  };

  return (
    <Animated.View
      // Fully hidden: unreachable by VoiceOver and can't eat a touch. `box
      // -none` (not `none`) the rest of the time — same as before — so the
      // header only claims touches its own children (the pill, search)
      // actually handle.
      pointerEvents={scroll.hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={scroll.hidden}
      importantForAccessibility={scroll.hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          // Solid until the material is mounted (and permanently on the
          // opaque tier) so no frame is ever backgroundless — same rule as
          // BottomSheet's shell.
          backgroundColor: showGlass ? 'transparent' : tokens.sheer.fallback,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: showGlass ? 'transparent' : tokens.sheer.edge,
        },
        scroll.style,
      ]}
    >
      {showGlass && (
        <Glass
          key={height}
          material="sheer"
          // No edge hairline on the glass tier — see the file header. The
          // opaque-tier band above still draws `sheer.edge` as its bottom
          // border, so Reduce Transparency/the flag-off fallback is
          // unaffected.
          edge={false}
          specular
          radius={0}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height! }}
        />
      )}
      <View
        onLayout={handleLayout}
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 24,
          paddingBottom: 10,
        }}
      >
        {/* flexWrap: large Dynamic Type can push the title above the pill;
            the measured height (onHeight above) keeps the content clear
            either way, and the keyed Glass follows it. */}
        <View className="flex-row items-center justify-between" style={{ flexWrap: 'wrap' }}>
          <Text
            className="text-text text-[28px] font-extrabold"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {title}
          </Text>
          {/* flexShrink so the cluster never overflows the padded box when
              the pill's label is huge (AX text sizes); the pill's own label
              truncates first. */}
          <View className="flex-row items-center" style={{ gap: 8, flexShrink: 1 }}>
            <PeriodPill label={period.label} onPress={period.onPress} />
            {right}
          </View>
        </View>
        {below}
      </View>
    </Animated.View>
  );
}

/** The period pill — not exported beyond this file unless a third caller
 *  appears (Phase 3). Same Pressable-wraps-Glass rule as Send (glass-phase2
 *  §4.3): the accessibilityLabel stays on the Pressable, and hitSlop lifts
 *  its ~32pt visual to the 44pt target without changing the header's height. */
function PeriodPill({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <Pressable onPress={onPress} accessibilityLabel="Change period" hitSlop={6} style={{ flexShrink: 1 }}>
      <Glass
        material="clear"
        radius={radius.pill}
        isInteractive
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          paddingVertical: 8,
          flexShrink: 1,
        }}
      >
        <Feather name="calendar" size={14} color={c.muted} />
        <Text
          className="text-text text-[13px] font-bold ml-2"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {label}
        </Text>
        <Feather name="chevron-down" size={14} color={c.muted} style={{ marginLeft: 4 }} />
      </Glass>
    </Pressable>
  );
}
