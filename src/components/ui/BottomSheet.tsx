import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, BackHandler } from 'react-native';
import { useThemeColors } from '../../theme/useThemeColors';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Portal } from '@gorhom/portal';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';

/**
 * Generic bottom-sheet dialog: a dimmed backdrop + a rounded sheet with a grab
 * handle and a header (✕ on the left, title centred, optional action on the
 * right). Body content scrolls with keyboard awareness. Rendered through a
 * root Portal so it covers the full screen (including the tab bar) under
 * KeyboardProvider.
 *
 * Public API — additive, back-compatible:
 *   visible, onClose, title, headerRight, children, footer (new, optional)
 *
 * When `footer` is provided the sheet interior becomes:
 *   header  → scrollable body (flex:1, children)  → pinned footer (flex:0)
 * When `footer` is omitted the sheet behaves exactly as before.
 *
 * Animation lifecycle:
 *  - `rendered` gates the Portal itself (starts true once visible, stays true
 *    until the exit animation finishes via withCallback → setRendered(false)).
 *  - `visible` gates the inner Animated.Views so Reanimated can play their
 *    `exiting` animations before the Portal unmounts.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  headerRight,
  children,
  footer,
  fillHeight = false,
  avoidKeyboard = true,
  dimBackdrop = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * When true the sheet uses `height: '92%'` (definite) instead of
   * `maxHeight: '92%'`. Use this when the body contains a flex:1 element
   * (e.g. TransactionFormSheet's AmountDisplay + ScrollView) that needs a
   * real height to grow into. Short content-sized sheets (manage-payee/
   * category/account) leave this false so they stay compact.
   */
  fillHeight?: boolean;
  /**
   * Whether the sheet lifts above the software keyboard. Default true (sheets
   * with a text field — manage-payee/category, note). Set false for a sheet
   * that has NO text input of its own (e.g. TransactionFormSheet, whose amount
   * is a keypad): otherwise, when a CHILD sheet stacked on top (Note editor)
   * raises the keyboard, this sheet would lift too and shove its keypad up.
   */
  avoidKeyboard?: boolean;
  /**
   * Whether the backdrop dims the content behind the sheet. Default true (a
   * standard modal scrim). Set false for a sheet stacked ON TOP of another
   * sheet (e.g. the Note editor over the transaction form) so the sheet behind
   * stays fully visible; the backdrop still catches taps to dismiss, it just
   * isn't tinted.
   */
  dimBackdrop?: boolean;
}) {
  const c = useThemeColors();
  // `rendered` stays true through the exit animation so the Portal (and the
  // Animated.Views inside it) remain mounted while SlideOutDown/FadeOut play.
  const [rendered, setRendered] = useState(visible);

  // Lift the (bottom-anchored) sheet above the software keyboard. A short sheet
  // (e.g. add-payee, note editor) would otherwise sit behind the keyboard —
  // padding the anchor container by the keyboard height raises it clear.
  //
  // We own the keyboard-height shared value and drive it from an explicit
  // `useKeyboardHandler` subscription rather than the shared context value from
  // `useReanimatedKeyboardAnimation`. The latter's `useAnimatedStyle` can fail
  // to register its dependency when a sheet mounts and auto-focuses a text field
  // in the SAME frame (Note editor, Payee/Category combobox): the keyboard rises
  // before the mapper subscribes, so the sheet never lifts and its input ends up
  // hidden behind the keyboard. An explicit handler catches every frame from the
  // moment it mounts, and we seed it from the current keyboard state so a sheet
  // opened while the keyboard is already up starts already lifted.
  const keyboardHeight = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
      },
    },
    []
  );
  useEffect(() => {
    if (!avoidKeyboard) return;
    try {
      if (KeyboardController.isVisible()) {
        keyboardHeight.value = KeyboardController.state().height;
      }
    } catch {
      // Native module unavailable (e.g. tests) — lift stays at rest.
    }
  }, [avoidKeyboard, keyboardHeight]);
  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: avoidKeyboard ? keyboardHeight.value : 0,
  }));

  // Ref kept in sync with `visible` so the worklet callback can read the
  // current value without capturing a stale closure. Guards against the
  // close→reopen race where a finishing exit would unmount an already-reopened
  // Portal.
  const visibleRef = useRef(visible);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) setRendered(true);
    // When visible goes false, setRendered(false) is called from the exit
    // animation callback (withCallback on the sheet), not here, so the Portal
    // stays mounted long enough for the animation to finish.
  }, [visible]);

  // Android hardware-back closes the sheet. Keyed off `visible` so the
  // listener is only active while the sheet is logically open (not while it
  // is animating out).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!rendered) return null;

  return (
    <Portal>
      {/* Full-screen absolute overlay — only present while visible */}
      {visible && (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          pointerEvents="box-none"
        >
          {/* Backdrop — full screen (behind any keyboard); tapping closes */}
          <Animated.View
            entering={FadeIn}
            exiting={FadeOut}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: dimBackdrop ? 'rgba(0,0,0,0.55)' : 'transparent' }}
              onPress={onClose}
            />
          </Animated.View>

          {/* Anchor container — bottom-aligns the sheet and pads up by the
              keyboard height so the sheet clears the keyboard. */}
          <Animated.View
            style={[
              { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
              liftStyle,
            ]}
            pointerEvents="box-none"
          >
            {/* Sheet — taps inside must NOT bubble to the backdrop */}
            <Animated.View
              entering={SlideInDown}
              exiting={SlideOutDown.withCallback((finished) => {
                'worklet';
                if (finished && !visibleRef.current) runOnJS(setRendered)(false);
              })}
              className="bg-surface rounded-t-3xl"
              style={[
                { display: 'flex', flexDirection: 'column' },
                fillHeight ? { height: '92%' } : { maxHeight: '92%' },
              ]}
            >
              {/* ── Header (flex:0) ── */}
              <View style={{ flexShrink: 0 }}>
                {/* Grab handle */}
                <View className="w-9 h-1.5 rounded-full self-center mt-3 mb-3" style={{ backgroundColor: c.grabHandle }} />

                {/* Header row */}
                <View className="flex-row items-center justify-between px-4 pb-3">
                  <Pressable
                    onPress={onClose}
                    className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
                    accessibilityLabel="Close"
                  >
                    <Feather name="x" size={16} color={c.muted} />
                  </Pressable>
                  <Text className="text-text text-base font-extrabold">{title}</Text>
                  <View className="w-8 h-8 items-center justify-center">{headerRight}</View>
                </View>
              </View>

              {/* ── Scrollable body ──
                  fillHeight sheets have a definite height, so the body fills it
                  (flex:1) and a flex:1 child can absorb slack. Content-sized
                  sheets (manage-*) must NOT use flex:1 — in an indefinite-height
                  sheet a flex:1 ScrollView collapses to zero. flexShrink:1 lets
                  the body size to its content and only scroll once it would
                  exceed the sheet's maxHeight. */}
              <ScrollView
                style={fillHeight ? { flex: 1 } : { flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 22,
                  paddingBottom: footer ? 8 : 28,
                  // When the sheet has a definite height (fillHeight), let the body
                  // column fill it so a flex:1 child (e.g. the amount display)
                  // absorbs the slack and centers.
                  flexGrow: fillHeight ? 1 : undefined,
                }}
              >
                {children}
              </ScrollView>

              {/* ── Pinned footer (flex:0), only rendered when provided ── */}
              {footer && (
                <View
                  style={{ flexShrink: 0, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 22 }}
                  // Manage-* sheets get a hairline above the footer button; the
                  // transaction sheet (fillHeight) has the keypad there instead.
                  className={fillHeight ? '' : 'border-t border-border'}
                >
                  {footer}
                </View>
              )}
            </Animated.View>
          </Animated.View>
        </View>
      )}
    </Portal>
  );
}
