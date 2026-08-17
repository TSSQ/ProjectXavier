/**
 * POC — a floating, Liquid-Glass tab bar in the shape of the iOS 26 App Store's:
 * a detached translucent pill above the safe area, with a brighter glass capsule
 * sliding under the selected item.
 *
 * Uses `expo-glass-effect`'s `GlassView`, which wraps Apple's real
 * `UIGlassEffect` — NOT a blur approximation. That distinction matters: the
 * system material samples and refracts what is behind it and adapts to content
 * and accessibility settings, which a `BlurView` cannot do.
 *
 * `GlassContainer` wraps both layers so the selected capsule and the bar itself
 * are treated as ONE glass system — that is what produces the merge/morph as
 * the capsule moves between items, rather than two independent panes stacked.
 *
 * FALLBACK IS NOT OPTIONAL, and this file originally got the reason wrong: it
 * claimed `isLiquidGlassAvailable()` goes false when the user has Reduce
 * Transparency on. It does not. That function's own documentation says the
 * value "may also be `true` if the user has enabled accessibility settings
 * that limit the Liquid Glass effect", and points at
 * `AccessibilityInfo.isReduceTransparencyEnabled()` instead — so a bar gated
 * on it alone renders glass at a user who explicitly asked for none, which is
 * an accessibility failure rather than a cosmetic one.
 *
 * The tier decision therefore comes from `useGlass()`, which combines all
 * three gates (availability, the iOS 26 beta API check, and Reduce
 * Transparency) in one pure, tested place — see src/theme/glassTokens.ts.
 */
import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, GlassContainer } from 'expo-glass-effect';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { useGlass } from '../../theme/useGlass';

/** Horizontal inset of the floating pill from the screen edges. */
const SIDE_INSET = 16;
/** Gap between the pill's bottom and the home indicator / screen bottom. */
const BOTTOM_GAP = 8;
/** Vertical padding inside the pill, around each item. */
const ITEM_PAD_V = 8;
const ICON_SIZE = 24;

export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const insets = useSafeAreaInsets();
  // All three gates, in one tested place — including Reduce Transparency,
  // which isLiquidGlassAvailable() does NOT report (see the header).
  const { tier } = useGlass();
  const glass = tier === 'native';

  // The label scales with Dynamic Type; the pill's height follows from it
  // rather than being a constant, so a large text setting grows the bar
  // instead of clipping it (the build-60 class of bug).
  const labelSize = Math.round(s.role.caption * 0.85);
  const itemHeight = ICON_SIZE + labelSize + ITEM_PAD_V * 2 + 6;

  const bar = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingHorizontal: 6,
        minHeight: itemHeight,
      }}
    >
      {state.routes.map((route, index) => {
        // `descriptors[key]` is typed as possibly-undefined; a route always has
        // one in practice, but skipping rather than asserting keeps a malformed
        // navigator from crashing the whole bar.
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : (options.title ?? route.name);
        const focused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const content = (
          <View style={{ alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {options.tabBarIcon?.({
              focused,
              color: focused ? c.primary : c.muted,
              size: ICON_SIZE,
            })}
            <Text
              numberOfLines={1}
              style={{
                fontSize: labelSize,
                fontWeight: focused ? '700' : '500',
                color: focused ? c.primary : c.muted,
              }}
            >
              {label}
            </Text>
          </View>
        );

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            // Plain object style — the function form is silently swallowed by
            // NativeWind's cssInterop and is banned by .eslintrc.js.
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: ITEM_PAD_V,
              minHeight: 44,
            }}
          >
            {focused && glass ? (
              // The selected capsule. `clear` reads brighter than the bar's
              // `regular`, which is what makes the selection legible without
              // painting a solid colour over the material.
              <GlassView
                glassEffectStyle="clear"
                isInteractive
                style={{
                  position: 'absolute',
                  left: 4,
                  right: 4,
                  top: 2,
                  bottom: 2,
                  borderRadius: 999,
                }}
              />
            ) : focused ? (
              <View
                style={{
                  position: 'absolute',
                  left: 4,
                  right: 4,
                  top: 2,
                  bottom: 2,
                  borderRadius: 999,
                  backgroundColor: c.surfaceAlt,
                }}
              />
            ) : null}
            {content}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: SIDE_INSET,
        right: SIDE_INSET,
        bottom: Math.max(insets.bottom, BOTTOM_GAP),
      }}
    >
      {glass ? (
        <GlassContainer spacing={20} style={{ borderRadius: 999 }}>
          <GlassView
            glassEffectStyle="regular"
            style={{ borderRadius: 999, overflow: 'hidden' }}
          >
            {bar}
          </GlassView>
        </GlassContainer>
      ) : (
        <View
          style={{
            borderRadius: 999,
            overflow: 'hidden',
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
            // A detached bar needs its own separation from the content behind
            // it; on the glass path the material provides that itself.
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
              },
              default: { elevation: 8 },
            }),
          }}
        >
          {bar}
        </View>
      )}
    </View>
  );
}
