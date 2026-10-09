/**
 * Xavier's hero-to-header move (docs/design/xavier-daily-chat-spec.md §3, §4).
 *
 * `HeroHeaderStage` owns the chat area: the feed, the hero layer, the pinned
 * header and the ONE avatar overlay all live in the one frame it measures, so
 * "slots and overlay share a coordinate space" is structural, not a convention.
 *
 * The avatar is a single `AssistantAvatar` in an absolutely positioned overlay
 * above both layouts, so it never remounts: his breathing and glow keep running
 * through the move and reactions play on him wherever he is. The hero slot is
 * measured from its own onLayout frame (its layer is absolute-fill at the stage origin); the header slot's centre is
 * known statically (`avatarHeader / 2` from the left edge, half the measured row
 * height down). One Reanimated progress value (0 = hero, 1 = header) moves and
 * shrinks the overlay between them.
 *
 * The animated layer is minimal for the shadow-tree cost (see XavierPet's
 * header): one view, transform + opacity only. He is drawn once at the hero size
 * and shrunk with a transform scale; XavierPet is told (`visualScale`,
 * `motionReference`) so his halo and lift are right for the size he appears at.
 *
 * The keyboard moves the hero: the stage shrinks as the keyboard rises, so the
 * centred slot rises by half of that. The overlay follows on the UI thread from
 * keyboard-controller's animation, in lockstep with the greeting.
 *
 * Reduce Motion: no movement. He is placed in the header slot at once and fades
 * in there, with the header, while the greeting fades out.
 *
 * Phase transitions are the pure reducer `layoutPhaseReduce` (chatFeed.ts);
 * `useLayoutPhase` feeds it events. The move ends from the animation's own
 * completion callback, never a timer.
 */
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  type SharedValue,
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AssistantAvatar } from '../AssistantAvatar';
import type { AvatarState } from '../../domain/avatar';
import { HERO_TRANSITION, LayoutPhase, layoutPhaseReduce } from '../../domain/chatFeed';
import { MOTION } from '../../theme/motion';
import { useScaledType } from '../../theme/useScaledType';
import { useThemeColors } from '../../theme/useThemeColors';

/** How far the greeting lifts as it fades out. */
const GREETING_LIFT = 12;
/** The header's fade below its row, in pt (spec asks 16-24): feed content dissolves under it. */
export const HEADER_FADE_TAIL = 20;
/** Opacity of the header's solid area, so the depth field is not hard-cut. */
const HEADER_SOLID_OPACITY = 0.94;
/** The header texts follow Dynamic Type up to here; past it the header would crowd the feed. */
const HEADER_MAX_FONT_MULTIPLIER = 1.3;

/** Minimum height of the pinned header's row (the avatar slot plus breathing room). */
export function pinnedHeaderHeight(avatarHeader: number): number {
  return avatarHeader + 12;
}

/** The layout phase, driven by the pure reducer. `resetEpoch` changing is a day reset (or restore clear). */
export function useLayoutPhase({
  loaded,
  quiet,
  resetEpoch,
}: {
  loaded: boolean;
  quiet: boolean;
  /** Bumped by every clear of the day (see `useChatLog`); a change is a day reset. */
  resetEpoch: number;
}) {
  const [phase, dispatch] = useReducer(layoutPhaseReduce, 'loading' as LayoutPhase);
  useEffect(() => {
    if (loaded) dispatch({ type: 'loaded', quiet });
    // Intentionally partial deps: the quiet flag is read at the moment of loading
    // only (the `notQuiet` effect below follows it afterwards). The repo does not
    // enable react-hooks/exhaustive-deps, so there is no rule to disable here.
  }, [loaded]);
  // Level-triggered: it also fires after a day reset while the day is still not
  // quiet (the reducer ignores it in every phase but `hero`), so the move plays.
  useEffect(() => {
    if (!quiet) dispatch({ type: 'notQuiet' });
  }, [quiet, phase]);
  const prevEpoch = useRef(resetEpoch);
  useEffect(() => {
    if (prevEpoch.current === resetEpoch) return;
    prevEpoch.current = resetEpoch;
    dispatch({ type: 'dayReset' });
  }, [resetEpoch]);
  const onMoveFinished = useCallback(() => dispatch({ type: 'moveFinished' }), []);
  return { phase, onMoveFinished };
}

function useHeroHeaderTransition({
  phase,
  onMoveFinished,
}: {
  phase: LayoutPhase;
  onMoveFinished: () => void;
}) {
  const s = useScaledType();
  const reduced = useReducedMotion();
  const size = s.avatarIdle;
  const headerSize = s.avatarHeader;
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Slot centres in the stage's frame.
  const heroX = useSharedValue(0);
  const heroY = useSharedValue(0);
  const headX = useSharedValue(headerSize / 2);
  const headY = useSharedValue(pinnedHeaderHeight(headerSize) / 2);
  const progress = useSharedValue(0); // 0 = hero, 1 = header
  const greeting = useSharedValue(1); // greeting bubble: 1 shown, 0 gone
  const headerText = useSharedValue(0); // header text + fade
  const fade = useSharedValue(1); // Reduce Motion: the avatar fading in at the header
  const ready = useSharedValue(0); // hidden until the slot it starts in is measured

  const seen = useRef({ hero: false, header: false });
  const phaseRef = useRef(phase);

  /** The avatar shows once the slot for the current layout is known. */
  const markReady = useCallback(() => {
    const known = phaseRef.current === 'header' ? seen.current.header : seen.current.hero;
    if (known) ready.value = 1;
  }, [ready]);

  /**
   * How far the keyboard has lifted the centred hero: the stage shrinks by about
   * the keyboard's height (the keyboard-avoiding padding minus the safe-area
   * give-back), so a centred slot rises by half of that. `height` is negative
   * while the keyboard is up.
   */
  const keyboardLift = () => {
    'worklet';
    return -keyboardHeight.value / 2;
  };

  /**
   * The hero slot's own layout. Its parent is an absolute-fill layer at the stage's
   * origin, so the frame is already in the stage's coordinates. (Measuring through
   * view refs is NOT used: on device the refs were still null when this fired, so
   * he never became ready and the hero showed no Xavier — Beta 144/145.)
   */
  const onHeroSlotLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { x, y, width: w, height: h } = e.nativeEvent.layout;
      // Store the REST position: the keyboard lift is applied on the UI thread, so
      // a measurement taken mid-lift must not count it twice.
      heroX.value = x + w / 2;
      heroY.value = y + h / 2 - keyboardHeight.value / 2;
      seen.current.hero = true;
      markReady();
    },
    [heroX, heroY, keyboardHeight, markReady]
  );

  /** The header row's measured height: the slot is vertically centred in it. */
  const onHeaderRowLayout = useCallback(
    (height: number) => {
      headY.value = height / 2;
      seen.current.header = true;
      markReady();
    },
    [headY, markReady]
  );

  useEffect(() => {
    headX.value = headerSize / 2;
  }, [headX, headerSize]);

  const prevPhase = useRef<LayoutPhase>('loading');
  // A layout effect: a day reset must clear `seen`/`ready` before the new hero
  // slot's layout event can arrive.
  useLayoutEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    phaseRef.current = phase;
    const ease = Easing.bezier(...MOTION.ease.standard);
    const finish = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(onMoveFinished)();
    };
    cancelAnimation(progress);
    cancelAnimation(greeting);
    cancelAnimation(headerText);
    cancelAnimation(fade);
    if (phase === 'hero') {
      if (was === 'header' && !seen.current.hero) {
        // A day reset from the header when the hero slot was never measured this
        // mount: hide him until it is. If it was measured before, that position
        // still holds (the hero slot sits in the same place every day), so he
        // stays visible; the re-measure below only refines it. Hiding him and
        // waiting on the slot's onLayout alone left him invisible on device
        // (Beta 144) when that event was missed.
        ready.value = 0;
      }
      progress.value = 0;
      greeting.value = 1;
      headerText.value = 0;
      fade.value = 1;
    } else if (phase === 'moving') {
      if (reduced) {
        // Reduce Motion: a real 240ms fade, not a cut (`ReduceMotion.Never` stops
        // Reanimated from skipping these under the system setting).
        const fadeTiming = { duration: HERO_TRANSITION.reducedFadeMs, reduceMotion: ReduceMotion.Never };
        greeting.value = withTiming(0, fadeTiming);
        progress.value = 1;
        fade.value = 0;
        fade.value = withTiming(1, fadeTiming);
        headerText.value = withTiming(1, fadeTiming, finish);
      } else {
        greeting.value = withTiming(0, { duration: HERO_TRANSITION.greetingMs });
        progress.value = withTiming(1, { duration: HERO_TRANSITION.moveMs, easing: ease });
        headerText.value = withDelay(
          HERO_TRANSITION.moveMs,
          withTiming(1, { duration: HERO_TRANSITION.headerFadeMs }, finish)
        );
      }
    } else if (phase === 'header') {
      progress.value = 1;
      greeting.value = 0;
      headerText.value = 1;
      fade.value = 1;
    }
    markReady();
  }, [phase, reduced, onMoveFinished, markReady, progress, greeting, headerText, fade, ready]);

  const ratio = headerSize / size;
  // The avatar's on-screen scale, also fed to XavierPet so its halo floor eases in
  // during the move rather than popping when the phase becomes `header`.
  const visualScale = useDerivedValue(() => interpolate(progress.value, [0, 1], [1, ratio]));
  const avatarStyle = useAnimatedStyle(() => {
    const cx = interpolate(progress.value, [0, 1], [heroX.value, headX.value]);
    const cy = interpolate(progress.value, [0, 1], [heroY.value - keyboardLift(), headY.value]);
    const k = visualScale.value;
    return {
      opacity: fade.value * ready.value,
      transform: [{ translateX: cx - size / 2 }, { translateY: cy - size / 2 }, { scale: k }],
    };
  });
  const greetingStyle = useAnimatedStyle(() => ({
    opacity: greeting.value,
    transform: [{ translateY: -GREETING_LIFT * (1 - greeting.value) }],
  }));
  const headerStyle = useAnimatedStyle(() => ({ opacity: headerText.value }));

  return {
    onHeroSlotLayout,
    onHeaderRowLayout,
    avatarStyle,
    greetingStyle,
    headerStyle,
    visualScale,
  };
}

/**
 * The pinned header: the avatar's slot, then "Xavier" over "Today · N logged".
 * A sibling OVER the feed (painted on top with zIndex, and first in tree order),
 * not part of it. A solid area through the bottom of the row, then a fade tail so
 * feed content scrolls cleanly underneath; it reaches up through the safe area
 * and out through the side padding so the fade covers the screen edges. Its
 * content row sits at the stage's top-left. The row's real height is measured
 * (Dynamic Type can grow it) and reported.
 */
function PinnedHeader({
  loggedToday,
  safeTop,
  edgeInset,
  onRowLayout,
  headerStyle,
  hidden,
}: {
  loggedToday: number;
  /** The screen's top padding (safe area + gap) the header reaches up through. */
  safeTop: number;
  /** The screen's side padding the header reaches out through. */
  edgeInset: number;
  onRowLayout: (height: number) => void;
  headerStyle: ReturnType<typeof useHeroHeaderTransition>['headerStyle'];
  /** Hidden from the screen reader until the header layout is settled. */
  hidden: boolean;
}) {
  const s = useScaledType();
  const c = useThemeColors();
  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        {
          position: 'absolute',
          top: -safeTop,
          left: -edgeInset,
          right: -edgeInset,
          paddingTop: safeTop,
          paddingBottom: HEADER_FADE_TAIL,
          paddingHorizontal: edgeInset,
          zIndex: 2,
        },
        headerStyle,
      ]}
    >
      {/* Solid through the bottom of the row, then the fade tail. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: HEADER_FADE_TAIL,
          backgroundColor: c.bg,
          opacity: HEADER_SOLID_OPACITY,
        }}
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: HEADER_FADE_TAIL }}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="pinned-header-fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.bg} stopOpacity={HEADER_SOLID_OPACITY} />
              <Stop offset="1" stopColor={c.bg} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#pinned-header-fade)" />
        </Svg>
      </View>
      <View
        pointerEvents="box-none"
        onLayout={(e) => onRowLayout(e.nativeEvent.layout.height)}
        style={{
          minHeight: pinnedHeaderHeight(s.avatarHeader),
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {/* The avatar's slot: empty and fixed-size, the overlay avatar sits here. */}
        <View pointerEvents="none" style={{ width: s.avatarHeader, height: s.avatarHeader }} />
        <View
          pointerEvents="none"
          accessible
          accessibilityRole="header"
          accessibilityLabel={`Xavier. Today, ${loggedToday} logged`}
        >
          <Text
            className="text-text"
            maxFontSizeMultiplier={HEADER_MAX_FONT_MULTIPLIER}
            style={{
              fontSize: s.role.sectionHeading,
              lineHeight: Math.round(s.role.sectionHeading * 1.1),
              fontWeight: '800',
            }}
          >
            Xavier
          </Text>
          <Text
            className="text-muted"
            maxFontSizeMultiplier={HEADER_MAX_FONT_MULTIPLIER}
            style={{ fontSize: s.role.caption }}
          >
            {`Today · ${loggedToday} logged`}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The single, never-remounting avatar, above both layouts.
 *
 * PAINT ORDER (zIndex): avatar (3) > pinned header (2) > hero layer > feed. The
 * header's solid fade must never cover him, in the header or mid-move.
 */
function TransitionAvatar({
  avatarStyle,
  state,
  visualScale,
}: {
  avatarStyle: ReturnType<typeof useHeroHeaderTransition>['avatarStyle'];
  state: AvatarState;
  /** His on-screen scale, animated with the move: XavierPet works his halo (floored at
   *  6pt on screen) and lift out for the size he appears at. The reference is his own
   *  hero size, so the hero looks exactly as it always did. */
  visualScale: SharedValue<number>;
}) {
  const s = useScaledType();
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: 'absolute', left: 0, top: 0, width: s.avatarIdle, height: s.avatarIdle, zIndex: 3 },
        avatarStyle,
      ]}
    >
      <AssistantAvatar
        size={s.avatarIdle}
        state={state}
        visualScaleValue={visualScale}
        motionReference={s.avatarIdle}
      />
    </Animated.View>
  );
}

/** The chat area: feed, hero layer, pinned header and the one avatar, in one frame. */
export function HeroHeaderStage({
  hidden = false,
  phase,
  onMoveFinished,
  avatarState,
  loggedToday,
  safeTop,
  edgeInset,
  greeting,
  greetingLabel,
  note,
  onHeroBackgroundPress,
  renderFeed,
}: {
  /** Held while a day check that may clear the chat is in flight: invisible, untouchable, unread. */
  hidden?: boolean;
  phase: LayoutPhase;
  onMoveFinished: () => void;
  avatarState: AvatarState;
  /** `null` until the day is known (the header is not drawn before then). */
  loggedToday: number | null;
  safeTop: number;
  edgeInset: number;
  /** The empty-day greeting bubble. */
  greeting: React.ReactNode;
  /** The greeting's text: with a note it is read together with it, as one element. */
  greetingLabel?: string;
  /** The one-time "yesterday's chat is cleared" line under the greeting, or null. It
   *  fades and lifts with the greeting. Caption type in `muted`, scaled like the greeting. */
  note?: string | null;
  onHeroBackgroundPress: () => void;
  /** Draws the feed, leaving `topInset` at its visual top for the pinned header. */
  renderFeed: (topInset: number) => React.ReactNode;
}) {
  const s = useScaledType();
  const t = useHeroHeaderTransition({ phase, onMoveFinished });
  const [rowHeight, setRowHeight] = useState(pinnedHeaderHeight(s.avatarHeader));
  const onRowLayout = useCallback(
    (height: number) => {
      setRowHeight(height);
      t.onHeaderRowLayout(height);
    },
    [t.onHeaderRowLayout]
  );
  const hasHeader = (phase === 'moving' || phase === 'header') && loggedToday !== null;
  return (
    <View
      style={{ flex: 1, opacity: hidden ? 0 : 1 }}
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      {hasHeader && (
        <PinnedHeader
          loggedToday={loggedToday}
          safeTop={safeTop}
          edgeInset={edgeInset}
          onRowLayout={onRowLayout}
          headerStyle={t.headerStyle}
          hidden={phase !== 'header'}
        />
      )}
      {(phase === 'moving' || phase === 'header') && renderFeed(rowHeight + HEADER_FADE_TAIL)}
      {(phase === 'hero' || phase === 'moving') && (
        // The empty day: Xavier's hero slot and his greeting. Mounted through the
        // exit; only the greeting fades and lifts away.
        <View
          pointerEvents={phase === 'hero' ? 'box-none' : 'none'}
          style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
        >
          {/* Backdrop tap target: a SIBLING behind the content so a tap on the field still focuses it. */}
          {phase === 'hero' && (
            <Pressable onPress={onHeroBackgroundPress} accessible={false} style={StyleSheet.absoluteFill} />
          )}
          <View
            pointerEvents="none"
            onLayout={t.onHeroSlotLayout}
            style={{ width: s.avatarIdle, height: s.avatarIdle }}
          />
          <Animated.View
            pointerEvents="none"
            style={t.greetingStyle}
            accessible={!!note && !!greetingLabel}
            accessibilityLabel={note && greetingLabel ? `${greetingLabel} ${note}` : undefined}
          >
            {greeting}
            {note ? (
              <Text
                className="text-muted text-center"
                style={{ fontSize: s.role.caption, marginTop: 10, maxWidth: 300, alignSelf: 'center' }}
              >
                {note}
              </Text>
            ) : null}
          </Animated.View>
        </View>
      )}
      {phase !== 'loading' && (
        <TransitionAvatar avatarStyle={t.avatarStyle} state={avatarState} visualScale={t.visualScale} />
      )}
    </View>
  );
}
