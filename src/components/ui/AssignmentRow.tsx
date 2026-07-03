/**
 * AssignmentRow — a single row in the assignment card.
 * Renders an icon + label on the left, and a value (or muted placeholder) +
 * chevron on the right. When `disabled` or no `onPress` is provided the row
 * is non-interactive and the chevron is hidden.
 *
 * Group multiple rows together in an AssignmentCard (exported below) which
 * applies the rounded surface container with inset hairline dividers between
 * rows (1px border, margin 0 16 per spec).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export interface AssignmentRowProps {
  icon: FeatherName;
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  disabled?: boolean;
}

export function AssignmentRow({
  icon,
  label,
  value,
  placeholder,
  onPress,
  disabled = false,
}: AssignmentRowProps) {
  const interactive = !!onPress && !disabled;
  const displayValue = value || placeholder;
  const isMuted = !value;

  const inner = (
    <View className="flex-row items-center px-4 py-3.5" style={{ gap: 12 }}>
      {/* Icon — muted tone */}
      <Feather name={icon} size={18} color={colors.textMuted} />

      {/* Label */}
      <Text className="text-text text-base w-20" numberOfLines={1}>
        {label}
      </Text>

      {/* Spacer */}
      <View className="flex-1" />

      {/* Value or placeholder */}
      {displayValue ? (
        <Text
          className={`text-base ${isMuted ? 'text-muted' : 'text-text font-semibold'}`}
          numberOfLines={1}
          style={{ maxWidth: 180, textAlign: 'right' }}
        >
          {displayValue}
        </Text>
      ) : null}

      {/* Chevron — only when interactive; faint color per spec */}
      {interactive && (
        <Feather name="chevron-right" size={18} color={colors.iconMuted} />
      )}
    </View>
  );

  if (interactive) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={`${label}: ${displayValue ?? 'not set'}`}
        accessibilityRole="button"
      >
        {inner}
      </Pressable>
    );
  }

  return <View accessible accessibilityLabel={`${label}: ${displayValue ?? 'not set'}`}>{inner}</View>;
}

/**
 * AssignmentCard — groups AssignmentRow children in a rounded surface card
 * with inset hairline dividers between rows (border color token, margin 0 16).
 */
export function AssignmentCard({ children }: { children: React.ReactNode }) {
  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View className="bg-surface border border-border rounded-md overflow-hidden">
      {childArray.map((child, idx) => (
        <View key={idx}>
          {idx > 0 && (
            <View
              className="border-t border-border"
              style={{ marginLeft: 16, marginRight: 16 }}
            />
          )}
          {child}
        </View>
      ))}
    </View>
  );
}
