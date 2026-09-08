/**
 * Chip — the shared selectable pill (glass-standard-adoption-spec.md S3,
 * style guide F5). Two surfaces: `canvas` (floats over content — glass,
 * `clear`/`tinted`) and `content` (sits inside a card — flat, `controlRaised`/
 * `primaryFill`).
 *
 * Selected is a DIFFERENT material on a DIFFERENT mount, never a prop change
 * on one Glass — the canvas Glass is keyed on `selected` so R5 (state never
 * changes a Glass prop) holds; the label Text is a sibling in front, so
 * VoiceOver focus survives the toggle (same idiom as Composer's field).
 *
 * `accessibilityRole="button"` (QA round 3): matches every other family
 * component now that 13 inline call sites are 5 components — fixing it once
 * here is 2 lines instead of a fresh sweep every time a new caller shows up.
 * Pressed feedback (opacity, like the rest of the family) for the same
 * reason: a filter pill gave no acknowledgement at all until the data
 * actually reloaded.
 */
import React, { useState } from 'react';
import { Pressable, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { radius } from '../../theme/tokens';
import { ICON } from '../../theme/assets';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  surface: 'canvas' | 'content';
  leading?: FeatherName;
  trailing?: FeatherName;
  /** "+N more" — a dashed sibling overlay (R5: overlay, never a Glass edge). */
  overflow?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Mutes the label without changing material or selection — the /account
   *  subtype step's "Skip" chip needs this while staying the same `clear`
   *  material as its siblings (glass-standard-adoption-spec.md S3). */
  tone?: 'default' | 'muted';
}

export function Chip({
  label,
  selected = false,
  onPress,
  surface,
  leading,
  trailing,
  overflow = false,
  disabled = false,
  accessibilityLabel,
  tone = 'default',
}: ChipProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const [pressed, setPressed] = useState(false);
  const pressableOpacity = disabled ? 0.35 : pressed ? 0.85 : 1;

  const labelColor = selected ? c.onAccent : tone === 'muted' ? c.muted : c.text;

  const content = (
    <>
      {leading && <Feather name={leading} size={ICON.sm} color={labelColor} />}
      <Text
        numberOfLines={1}
        style={{ fontSize: s.role.rowLabel, fontWeight: '600', color: labelColor, flexShrink: 1 }}
      >
        {label}
      </Text>
      {trailing && <Feather name={trailing} size={ICON.sm} color={labelColor} />}
    </>
  );

  const boxStyle = {
    minHeight: s.chipHeight,
    paddingHorizontal: 15,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  };

  if (surface === 'content') {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled, selected }}
        style={{
          ...boxStyle,
          borderRadius: radius.pill,
          opacity: pressableOpacity,
          backgroundColor: selected ? c.primaryFill : c.controlRaised,
          ...(selected ? null : c.elevation.raised),
        }}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      style={{ opacity: pressableOpacity }}
    >
      <Glass
        key={selected ? 'selected' : 'unselected'}
        material={selected ? 'tinted' : 'clear'}
        radius={radius.pill}
        isInteractive
        style={boxStyle}
      >
        {content}
      </Glass>
      {overflow && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: c.borderAccent,
            borderRadius: radius.pill,
          }}
        />
      )}
    </Pressable>
  );
}
