/**
 * TextAction — a plain text link ("Not now", "Cancel", "Dismiss",
 * "Set them myself"): primary-coloured, semibold, no surface. One component
 * for the several places that were copying the same Pressable and Text.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useThemeColors } from '../../theme/useThemeColors';

export function TextAction({
  label,
  onPress,
  accessibilityLabel,
  size = 14,
  padded = true,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  size?: number;
  /** A little horizontal padding, for sitting beside a button. */
  padded?: boolean;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text
        style={{
          color: c.primary,
          fontSize: size,
          fontWeight: '600',
          paddingHorizontal: padded ? 6 : 0,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
