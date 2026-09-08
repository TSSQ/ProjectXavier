import React from 'react';
import { View, Pressable, Text } from 'react-native';
import { cn } from './cn';
import { useScaledType } from '../../theme/useScaledType';

/** Pill segmented control (e.g. day / week / month / year). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Smaller segment (minHeight 32) with a `caption`-sized label — RepeatSheet's
   *  Day/Week/Month/Year picker needs this to fit four labels without
   *  truncating (glass-standard-adoption-spec.md S5). */
  compact?: boolean;
}) {
  const s = useScaledType();
  return (
    <View className="flex-row bg-wellRecessed rounded-pill p-1">
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            className={cn(
              'flex-1 items-center justify-center rounded-pill',
              !compact && 'py-2',
              active && 'bg-primaryFill'
            )}
            style={compact ? { minHeight: 32 } : undefined}
            // `compact`'s 32pt segment is under the style guide's 44 floor —
            // hitSlop lifts the tappable area to 44 tall without changing
            // the visual size (QA round 3). Vertical only: these segments
            // sit edge-to-edge in a row, so horizontal hitSlop would make
            // adjacent segments' tap targets overlap.
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
          >
            <Text
              className={cn(
                'capitalize',
                !compact && 'text-sm',
                active ? 'text-white font-semibold' : 'text-muted'
              )}
              style={compact ? { fontSize: s.role.caption } : undefined}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
