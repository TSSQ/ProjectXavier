import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import {
  actionsWidth as computeActionsWidth,
  clampTranslate,
  resolveSnap,
  shouldClaimHorizontal,
} from '../../domain/swipeReveal';

export interface SwipeAction {
  /** Stable id for this action within the row — also what's dispatched by
   *  `accessibilityActions`/`onAccessibilityAction` on the row that renders
   *  it (see TransactionRow), so VoiceOver users get the same two actions
   *  without swiping. */
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: 'negative';
  onPress: () => void;
}

interface Props {
  /** This row's own identity (e.g. `tx.id`) — compared against `openKey` so
   *  the row knows whether IT is the currently-revealed one. Single-open
   *  state is lifted to the screen (one `openRowId`), not kept locally here:
   *  opening a different row changes `openKey`, which springs this row shut
   *  via the effect below — no cross-row refs, no imperative handles. */
  rowKey: string;
  actions: SwipeAction[];
  openKey: string | null;
  onOpen: (key: string) => void;
  onClose: () => void;
  /** Fires true when a horizontal drag is claimed, false when it ends —
   *  screens use this to set the SectionList's `scrollEnabled={!swiping}`
   *  (spec §4.7) so a swipe in progress can't also scroll the list. */
  onSwipeActive?: (active: boolean) => void;
  children: React.ReactNode;
}

/** Reanimated spring used for both the release-snap and the "sprung shut
 *  externally" case — same feel either way. */
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;

/** Icon size is fixed, not Dynamic-Type-scaled — the label beside it
 *  carries the scaling, so a growing glyph would only crowd it. */
const ICON_SIZE = 18;
const BUTTON_PAD_H = 14;
/** iOS's own swipe actions (Mail, Reminders) are flush, not gapped — each
 *  action is its own colour block with no seam between them. */
const BUTTON_GAP = 0;
const MIN_BUTTON_WIDTH = 64;

/**
 * Thin RN wrapper around the pure gesture math in `src/domain/swipeReveal.ts`:
 * owns the `PanResponder`, one Reanimated shared value, and the (absolutely
 * positioned) action strip revealed behind `children`. See
 * docs/design/swipe-row-actions-spec.md §4.2 for the full design.
 *
 * `onStartShouldSetPanResponder` is always false, so a tap/long-press on
 * `children` resolves completely normally (tap-to-Edit) unless the
 * drag becomes unambiguously horizontal, at which point
 * `onMoveShouldSetPanResponder` claims it — the same responder-stealing
 * trick `react-native-swipe-list-view` uses to swipe inside a
 * FlatList/SectionList without `react-native-gesture-handler` (spec §3.3).
 */
export function SwipeableRow({
  rowKey,
  actions,
  openKey,
  onOpen,
  onClose,
  onSwipeActive,
  children,
}: Props) {
  const s = useScaledType();
  const isOpen = openKey === rowKey;

  const fontSize = s.role.caption;
  const widthArgs = {
    fontSize,
    iconSize: ICON_SIZE,
    padH: BUTTON_PAD_H,
    gap: BUTTON_GAP,
    minButtonWidth: MIN_BUTTON_WIDTH,
  };
  // Same formula, `count: 1` vs. `actions.length` — a single source of truth
  // for the strip's total width and each button's own width, so they can
  // never drift apart (spec §4.6).
  const stripWidth = computeActionsWidth({ ...widthArgs, count: actions.length });
  const buttonWidth = computeActionsWidth({ ...widthArgs, count: 1 });

  const translateX = useSharedValue(0);

  // Mutable "latest" bag so the PanResponder (created once, below) always
  // reads fresh props without needing to be recreated mid-gesture.
  const latest = useRef({ isOpen, stripWidth, rowKey, onOpen, onClose, onSwipeActive });
  latest.current = { isOpen, stripWidth, rowKey, onOpen, onClose, onSwipeActive };

  // The only externally-driven transition this row needs to react to is
  // "stop being the open one" — becoming open always originates from this
  // row's own gesture (handled directly, below, for zero-latency feedback).
  // Springing shut here covers every external trigger uniformly: another
  // row opening, list scroll, a sheet/menu opening, or a refresh that
  // dropped this row's transaction — all of them just change `openKey`.
  useEffect(() => {
    if (!isOpen) {
      translateX.value = withSpring(0, SPRING);
    }
  }, [isOpen, translateX]);

  const startTranslate = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        actions.length > 0 &&
        shouldClaimHorizontal({ dx: gestureState.dx, dy: gestureState.dy }),
      onPanResponderGrant: () => {
        startTranslate.current = latest.current.isOpen ? -latest.current.stripWidth : 0;
        latest.current.onSwipeActive?.(true);
      },
      onPanResponderMove: (_evt, gestureState) => {
        translateX.value = clampTranslate(
          startTranslate.current + gestureState.dx,
          latest.current.stripWidth
        );
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const snap = resolveSnap({
          translateX: translateX.value,
          velocityX: gestureState.vx,
          actionsWidth: latest.current.stripWidth,
        });
        if (snap === 'open') {
          translateX.value = withSpring(-latest.current.stripWidth, SPRING);
          latest.current.onOpen(latest.current.rowKey);
        } else {
          translateX.value = withSpring(0, SPRING);
          // Only clear the screen's openRowId if THIS row actually owned it
          // (started open, dragged back closed). A drag on an already-closed
          // row that snaps back to closed is a no-op for this row and must
          // NOT clear whichever *other* row the screen currently has open.
          if (latest.current.isOpen) {
            latest.current.onClose();
          }
        }
        latest.current.onSwipeActive?.(false);
      },
      onPanResponderTerminate: () => {
        // Abandoned gesture (interrupted before release) — revert to
        // whatever this row's state was before the drag started, without
        // deciding open/closed and without touching the screen's
        // openRowId (same cross-row hazard as above).
        translateX.value = withSpring(startTranslate.current, SPRING);
        latest.current.onSwipeActive?.(false);
      },
    })
  ).current;

  // zIndex pins the row above the strip regardless of paint-order edge
  // cases: the row must always cover the strip at rest and progressively
  // uncover it while dragging, at every translateX in between.
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    zIndex: 1,
  }));

  if (actions.length === 0) {
    return <>{children}</>;
  }

  return (
    <View style={{ position: 'relative' }}>
      {/* Action strip — absolutely positioned behind the row; top/bottom: 0
          (no height constant) so it always matches the row's own rendered
          height, including at large Dynamic Type (spec §4.6). Non-interactive
          while closed so a tap in that region never reaches a hidden button. */}
      <View
        pointerEvents={isOpen ? 'auto' : 'none'}
        className="rounded-md overflow-hidden"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: stripWidth,
          flexDirection: 'row',
          gap: BUTTON_GAP,
        }}
      >
        {actions.map((action) => (
          <SwipeActionButton key={action.key} action={action} width={buttonWidth} fontSize={fontSize} />
        ))}
      </View>

      <Animated.View {...panResponder.panHandlers} style={bodyStyle}>
        {children}
        {/* Tap-outside-closes: while open, an invisible overlay sits on top
            of `children` and closes the row on tap instead of letting the
            tap reach the row's own onPress (spec §4.7). Absent while closed,
            so it never intercepts normal taps/long-presses. */}
        {isOpen && (
          <Pressable
            onPress={() => {
              translateX.value = withSpring(0, SPRING);
              onClose();
            }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        )}
      </Animated.View>
    </View>
  );
}

/**
 * One revealed action button. Plain object `style`, not the function form —
 * NativeWind's cssInterop swallows function-form `style` on a wrapped
 * Pressable (see .eslintrc.js and the note on AmountKeypad's
 * MenuRow); pressed feedback comes from local state via
 * onPressIn/onPressOut instead.
 */
function SwipeActionButton({
  action,
  width,
  fontSize,
}: {
  action: SwipeAction;
  width: number;
  fontSize: number;
}) {
  const c = useThemeColors();
  const [pressed, setPressed] = useState(false);
  const negative = action.tone === 'negative';
  const bg = negative ? c.deleteChipBg : c.surfaceAlt;
  const fg = negative ? c.deleteIcon : c.text;

  return (
    <Pressable
      onPress={action.onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={{
        width,
        minWidth: width,
        minHeight: 44, // HIG touch target — never a shorter constant.
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: pressed ? 0.7 : 1,
      }}
    >
      <Feather name={action.icon} size={ICON_SIZE} color={fg} />
      {/* Icon above label (Pressable's default flexDirection is column) so a
          long label at large Dynamic Type grows the button's height instead
          of clipping — numberOfLines caps it at one line regardless. */}
      <Text numberOfLines={1} style={{ fontSize, fontWeight: '600', color: fg, marginTop: 4 }}>
        {action.label}
      </Text>
    </Pressable>
  );
}
