import React from 'react';
import { View, Pressable, Text } from 'react-native';
import { cn } from './cn';

/** Pill segmented control (e.g. day / week / month / year). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row bg-surfaceAlt rounded-pill p-1">
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            className={cn(
              'flex-1 items-center py-2 rounded-pill',
              active && 'bg-primary'
            )}
          >
            <Text
              className={cn(
                'text-sm capitalize',
                active ? 'text-white font-semibold' : 'text-muted'
              )}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
