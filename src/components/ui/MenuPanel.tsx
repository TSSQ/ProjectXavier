/**
 * MenuPanel / MenuRow — the shared floating-menu shell (glass-standard-
 * adoption-spec.md S6, style guide F9). Unifies ContextMenu's `bottomRight`
 * panel and the composer's SlashMenu.
 *
 * `glass` renders a `panel`-material Glass behind the content as a childless
 * sibling keyed on the measured height (R6, the same idiom as Composer's
 * field and ScreenHeader) — pass it ONLY on an anchor that never enters via a
 * Reanimated layout animation (R9): ContextMenu's `bottomRight` mode and
 * SlashMenu both qualify (in-flow siblings, no `entering`); `point` mode (a
 * fading `Modal`) does not and must stay flat.
 */
import React, { useState } from 'react';
import {
  View,
  ViewProps,
  Pressable,
  Text,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { useGlass } from '../../theme/useGlass';
import { radius } from '../../theme/tokens';
import { ICON } from '../../theme/assets';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { settleMeasuredHeight } from '../../domain/layoutSettle';
import { mayMountGlass } from '../../domain/glassMountGate';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

// Exported (QA round 3): ContextMenu's `point`-mode width/height estimate
// (estimateMenuWidth, computeMenuPlacement — never measured, since a Modal
// is placed before its content lays out) has to reproduce these same
// numbers or it silently skews. Importing them beats duplicating +
// commenting: the ICON_SIZE constant already did this (`ICON.md` from
// assets.ts) and the others didn't, which is what let them drift silently.
export const PANEL_PAD_V = 4;
export const MENU_ROW_PAD_H = 14;
export const MENU_ROW_GAP = 10;
export const MENU_ROW_MARGIN_H = 4;

export interface MenuPanelProps extends ViewProps {
  /** See the file header — only pass this on an animation-free anchor. */
  glass?: boolean;
}

export function MenuPanel({ glass = false, style, children, ...rest }: MenuPanelProps) {
  const c = useThemeColors();
  const { tier } = useGlass();
  const [height, setHeight] = useState<number | null>(null);
  const showGlass = glass && mayMountGlass({ tier, measured: height });

  const handleLayout = (e: LayoutChangeEvent) => {
    setHeight(settleMeasuredHeight(e.nativeEvent.layout.height));
  };

  return (
    // Three layers, not one, because of an iOS quirk (QA round 3 BLOCKER
    // B2): `overflow:'hidden'` (`clipsToBounds`) never draws its OWN
    // shadow, AND clips a SUBVIEW's shadow too — so a single view carrying
    // both the clip (to shape the Glass sibling) and `elevation.overlay`
    // renders no shadow at all, on either tier, in either theme. Moving
    // `elevation.overlay` to the outer view fails the same way if IT is
    // also the one clipping. So: outer = shadow host only (no radius, no
    // clip — the shadow renders freely); middle = radius + clip, hosting
    // the Glass sibling (which self-clips too — Glass.tsx's own `radius`
    // prop — this is belt-and-suspenders for the content layer's pressed-
    // row highlights spilling past the rounded corners); inner = content,
    // with the SAME borderRadius as the middle layer so its own hairline
    // border (opaque tier) is drawn as a rounded stroke instead of a
    // rectangle the middle layer's clip then slices at an angle — that
    // mismatch was the secondary artifact (a border reading as four
    // segments that stop short of the corners).
    <View style={[showGlass ? null : c.elevation.overlay, style]} {...rest}>
      <View style={{ borderRadius: radius.md, overflow: 'hidden' }}>
        {showGlass && (
          <Glass
            key={height}
            material="panel"
            radius={radius.md}
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height! }}
          />
        )}
        <View
          onLayout={handleLayout}
          style={{
            borderRadius: radius.md,
            paddingVertical: PANEL_PAD_V,
            backgroundColor: showGlass ? 'transparent' : c.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: showGlass ? 'transparent' : c.border,
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}

export interface MenuRowProps {
  label: string;
  /** A second, muted line under the label (SlashMenu's command/"What can I
   *  ask?" rows). Omit for a single-line row (ContextMenu's items). */
  subtitle?: string;
  icon?: FeatherName;
  trailing?: FeatherName;
  tone?: 'negative';
  onPress: () => void;
  accessibilityLabel?: string;
  /** Row height floor — 44 by default (style guide F9). ContextMenu passes
   *  its own Dynamic-Type-scaled estimate so the rendered row stays in step
   *  with the `computeMenuPlacement` math built from that same estimate. */
  minHeight?: number;
  /** Label size — defaults to `rowLabel`. ContextMenu passes its existing
   *  (smaller, `caption`) size — see that file for why. */
  fontSize?: number;
}

export function MenuRow({
  label,
  subtitle,
  icon,
  trailing,
  tone,
  onPress,
  accessibilityLabel,
  minHeight = 44,
  fontSize,
}: MenuRowProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const [pressed, setPressed] = useState(false);
  const color = tone === 'negative' ? c.negative : c.text;
  const size = fontSize ?? s.role.rowLabel;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        // `justifyContent: 'space-between'` only when there's a trailing
        // icon to push to the far edge — ContextMenu's rows (no trailing)
        // are unaffected.
        justifyContent: trailing ? 'space-between' : 'flex-start',
        gap: MENU_ROW_GAP,
        paddingHorizontal: MENU_ROW_PAD_H,
        minHeight,
        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
        borderRadius: radius.sm,
        marginHorizontal: MENU_ROW_MARGIN_H,
      }}
    >
      {icon && (
        <Feather name={icon} size={ICON.md} color={tone === 'negative' ? c.negative : c.muted} />
      )}
      {/* `flexShrink`, NOT `flex: 1` — this row's own width is only ever
          RESOLVED (not stretched from a definite parent) when it sits in
          ContextMenu's min/maxWidth-auto-sized panel: `flex: 1` sets
          flexBasis to 0, which Yoga cannot grow from an unresolved parent
          width and collapses the label to a sliver ("T…"). flexShrink keeps
          the label at its natural content width, only shrinking once the
          panel's resolved width is actually tighter than that. */}
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: size, fontWeight: '500', color }}>
          {label}
        </Text>
        {subtitle && (
          <Text numberOfLines={1} style={{ fontSize: s.role.caption, color: c.muted, marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing && <Feather name={trailing} size={ICON.md} color={c.muted} />}
    </Pressable>
  );
}
