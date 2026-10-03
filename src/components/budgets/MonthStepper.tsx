/**
 * The month pill with ‹ › steppers used in the Budget screens' headers
 * (mockup `.pill` "‹ October ›"). The label carries the year only when it is
 * not the current one.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import { MonthKey, addMonths, monthLabel } from '../../domain/budgets';

export const monthPillLabel = (month: MonthKey, now: number): string => monthLabel(month, now);

export function MonthStepper({
  month,
  now,
  onChange,
}: {
  month: MonthKey;
  now: number;
  onChange: (next: MonthKey) => void;
}) {
  const c = useThemeColors();
  const arrow = (delta: number, glyph: string, label: string) => (
    <Pressable
      onPress={() => onChange(addMonths(month, delta))}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={{ color: c.primary, fontSize: 16, fontWeight: '700' }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View
      className="flex-row items-center bg-controlRaised border border-border"
      style={{ borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, gap: 8, ...c.elevation.raised }}
    >
      {arrow(-1, '‹', 'Previous month')}
      <Text className="text-text text-[13px] font-bold">{monthPillLabel(month, now)}</Text>
      {arrow(1, '›', 'Next month')}
    </View>
  );
}
