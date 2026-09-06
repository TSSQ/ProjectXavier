/**
 * ScreenHeader — the sticky chrome-glass header shared by Dashboard and
 * Transactions (glass-chrome-adoption-spec.md D2). Carries the screen title
 * and a single `PeriodPill`, retiring the two hand-rolled period-pill copies
 * those screens used to keep separately (Redline C4).
 *
 * Positioned absolutely at the top of the screen so content scrolls UNDER
 * the glass and refracts through it — the caller measures the header's laid
 * -out height via `onHeight` and applies it as the scroll view's own
 * `paddingTop` (mockup note 2/3).
 *
 * The header mounts with the screen (a UIKit tab switch, no Reanimated
 * layout animation above it) — the same situation as the composer tray, so
 * no settle gate is needed. Do NOT wrap this in an `Animated.View` with
 * `entering`: see the Glass first-layout hazard in Glass.tsx's header
 * comment.
 */
import React, { ReactNode, useState } from 'react';
import { View, Text, Pressable, LayoutChangeEvent, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { useGlass } from '../../theme/useGlass';
import { settleMeasuredHeight } from '../../domain/layoutSettle';
import { useThemeColors } from '../../theme/useThemeColors';
import { radius } from '../../theme/tokens';

/** Height of the header's own content below the status bar at the default
 *  text size (8 top + ~44 title row + 10 bottom). Screens seed their scroll
 *  padding with `insets.top + SCREEN_HEADER_ESTIMATE` so the first frame —
 *  before `onHeight` has reported the measured value — already clears the
 *  bar instead of starting from 0 and snapping. */
export const SCREEN_HEADER_ESTIMATE = 62;

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
}

export function ScreenHeader({ title, period, right, below, onHeight }: ScreenHeaderProps) {
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
  const showGlass = tier === 'native' && height !== null;

  const handleLayout = (e: LayoutChangeEvent) => {
    const h = settleMeasuredHeight(e.nativeEvent.layout.height);
    setHeight(h);
    onHeight(h);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        // Solid until the material is mounted (and permanently on the
        // opaque tier) so no frame is ever backgroundless — same rule as
        // BottomSheet's shell.
        backgroundColor: showGlass ? 'transparent' : tokens.chrome.fallback,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: showGlass ? 'transparent' : tokens.chrome.edge,
      }}
    >
      {showGlass && (
        <Glass
          key={height}
          material="chrome"
          edge
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
    </View>
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
