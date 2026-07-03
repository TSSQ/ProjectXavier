/**
 * AmountField — a tappable amount display that looks identical to Input.
 *
 * Renders as a Pressable (not a TextInput) so it never summons the system
 * keyboard. Tapping opens a KeypadSheet (wired by the caller via `onPress`).
 *
 * Styling mirrors Input exactly:
 *   bg-surface text-text border border-border rounded-sm px-3 py-3 text-base
 *   minHeight 48, lineHeight 20, letterSpacing 0
 * Placeholder text uses the same muted color (#9AA4B2) Input uses.
 */
import React, { useCallback } from 'react';
import { Keyboard, Pressable, Text } from 'react-native';
import { formatMoney } from '../../domain/money';
import { colors } from '../../theme/tokens';

export interface AmountFieldProps {
  /** Minor-unit value to display. null = show placeholder. */
  valueMinor: number | null;
  currency?: string;
  placeholder?: string;
  onPress: () => void;
}

/** Muted placeholder color — matches Input's placeholderTextColor. */
const PLACEHOLDER_COLOR = colors.textMuted;
/** Normal input text color — matches Input's text-text token. */
const TEXT_COLOR = colors.text;

export function AmountField({
  valueMinor,
  currency,
  placeholder = 'Amount',
  onPress,
}: AmountFieldProps) {
  const isEmpty = valueMinor === null;

  // Dismiss the OS keyboard (e.g. left up by a sibling text field like the
  // account-name Input) before opening the custom keypad, so the two input
  // surfaces never stack. The form ScrollView uses
  // keyboardShouldPersistTaps="handled", so the tap won't auto-dismiss.
  const handlePress = useCallback(() => {
    Keyboard.dismiss();
    onPress();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={isEmpty ? placeholder : formatMoney(valueMinor, currency)}
      style={{
        backgroundColor: colors.surface, // bg-surface
        borderWidth: 1,
        borderColor: colors.border,      // border-border
        borderRadius: 8,            // rounded-sm
        paddingHorizontal: 12,      // px-3
        paddingVertical: 12,        // py-3
        minHeight: 48,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: 16,             // text-base
          lineHeight: 20,
          letterSpacing: 0,
          color: isEmpty ? PLACEHOLDER_COLOR : TEXT_COLOR,
        }}
        numberOfLines={1}
      >
        {isEmpty ? placeholder : formatMoney(valueMinor, currency)}
      </Text>
    </Pressable>
  );
}
