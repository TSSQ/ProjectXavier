/**
 * AssignmentRow — a single row in the assignment card.
 * Renders an icon + label on the left, and a value (or muted placeholder) +
 * chevron on the right. When `disabled` or no `onPress` is provided the row
 * is non-interactive and the chevron is hidden.
 *
 * Group multiple rows together in an AssignmentCard (exported below) which
 * applies the rounded bg-surfaceAlt container with hairline dividers.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

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
      {/* Icon */}
      <Feather name={icon} size={17} color="#9AA4B2" />

      {/* Label */}
      <Text className="text-text text-[15px] w-20" numberOfLines={1}>
        {label}
      </Text>

      {/* Spacer */}
      <View className="flex-1" />

      {/* Value or placeholder */}
      {displayValue ? (
        <Text
          className={`text-[15px] font-semibold ${isMuted ? 'text-muted' : 'text-text'}`}
          numberOfLines={1}
          style={{ maxWidth: 180, textAlign: 'right' }}
        >
          {displayValue}
        </Text>
      ) : null}

      {/* Chevron — only when interactive */}
      {interactive && (
        <Feather name="chevron-right" size={15} color="#9AA4B2" />
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
 * AssignmentCard — groups AssignmentRow children in a rounded surfaceAlt card
 * with hairline dividers between rows.
 */
export function AssignmentCard({ children }: { children: React.ReactNode }) {
  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View className="bg-surfaceAlt rounded-2xl overflow-hidden">
      {childArray.map((child, idx) => (
        <View key={idx}>
          {idx > 0 && (
            <View
              style={{
                height: 1,
                backgroundColor: 'rgba(255,255,255,0.06)',
                marginLeft: 48,
              }}
            />
          )}
          {child}
        </View>
      ))}
    </View>
  );
}
