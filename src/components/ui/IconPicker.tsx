import React, { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { displayedIcons } from '../../domain/icons';

interface IconPickerProps {
  icons: string[];
  value?: string | null;
  onSelect: (icon: string) => void;
}

/**
 * Wrapping grid of emoji Pressables. The selected emoji is highlighted with a
 * primary border and surfaceAlt background. If `value` is truthy and not in
 * `icons`, it is prepended so a previously-typed custom emoji stays visible
 * (see displayedIcons in src/domain/icons).
 */
export function IconPicker({ icons, value, onSelect }: IconPickerProps) {
  const displayed = useMemo(() => displayedIcons(icons, value), [icons, value]);

  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {displayed.map((emoji) => {
        const selected = emoji === value;
        return (
          <Pressable
            key={emoji}
            onPress={() => onSelect(emoji)}
            style={{ width: 44, height: 44 }}
            className={
              selected
                ? 'items-center justify-center rounded-lg border-2 border-primary bg-surfaceAlt'
                : 'items-center justify-center rounded-lg border-2 border-transparent bg-surfaceAlt'
            }
            accessibilityLabel={emoji}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
