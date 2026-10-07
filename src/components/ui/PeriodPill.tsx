/**
 * The glass period pill (calendar + label + chevron-down) that opens a period
 * sheet. Shared by ScreenHeader (Dashboard, Transactions) and the Budget
 * screens.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { useThemeColors } from '../../theme/useThemeColors';
import { radius } from '../../theme/tokens';

/** The period pill. Shared by ScreenHeader (Dashboard, Transactions) and the
 *  Budget screens. Same Pressable-wraps-Glass rule as Send (glass-phase2
 *  §4.3): the accessibilityLabel stays on the Pressable, and hitSlop lifts
 *  its ~32pt visual to the 44pt target without changing the header's height. */
export function PeriodPill({
  label,
  onPress,
  a11yLabel = 'Change period',
}: {
  label: string;
  onPress: () => void;
  /** Spoken prefix; the current label is appended so it is read out. */
  a11yLabel?: string;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a11yLabel}, ${label}`}
      hitSlop={6}
      style={{ flexShrink: 1 }}
    >
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
