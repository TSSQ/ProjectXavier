import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, BackHandler } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
} from 'react-native-reanimated';
import { Portal } from '@gorhom/portal';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';

/**
 * Generic bottom-sheet dialog: a dimmed backdrop + a rounded sheet with a grab
 * handle and a header (✕ on the left, title centred, optional action on the
 * right). Body content scrolls with keyboard awareness. Rendered through a
 * root Portal so it covers the full screen (including the tab bar) under
 * KeyboardProvider.
 *
 * Public API is unchanged: visible, onClose, title, headerRight, children.
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
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  // `rendered` stays true through the exit animation so the Portal (and the
  // Animated.Views inside it) remain mounted while SlideOutDown/FadeOut play.
  const [rendered, setRendered] = useState(visible);

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
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'flex-end',
          }}
          pointerEvents="box-none"
        >
          {/* Backdrop — tapping it closes the sheet */}
          <Animated.View
            entering={FadeIn}
            exiting={FadeOut}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
              onPress={onClose}
            />
          </Animated.View>

          {/* Sheet — taps inside must NOT bubble to the backdrop */}
          <Animated.View
            entering={SlideInDown}
            exiting={SlideOutDown.withCallback((finished) => {
              'worklet';
              if (finished && !visibleRef.current) runOnJS(setRendered)(false);
            })}
            className="bg-[#23262C] rounded-t-2xl px-4 pt-3 pb-7"
            style={{ maxHeight: '92%' }}
          >
            {/* Grab handle */}
            <View className="w-9 h-1.5 rounded-full bg-[#4a4f57] self-center mb-3" />

            {/* Header row */}
            <View className="flex-row items-center justify-between mb-3">
              <Pressable
                onPress={onClose}
                className="w-8 h-8 rounded-full bg-[#33373e] items-center justify-center"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={16} color="#cfd6df" />
              </Pressable>
              <Text className="text-text text-base font-extrabold">{title}</Text>
              <View className="w-8 h-8 items-center justify-center">{headerRight}</View>
            </View>

            {/* Keyboard-aware scrollable body */}
            <KeyboardAwareScrollView
              keyboardShouldPersistTaps="handled"
              bottomOffset={24}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </KeyboardAwareScrollView>
          </Animated.View>
        </View>
      )}
    </Portal>
  );
}
