/**
 * AmountDisplay — shows the current amount expression as large centered text
 * with an outline currency badge above it.
 *
 * Design: outline currency badge (surfaceAlt bg, border, pill) centered above
 * the amount figure (large, adjustsFontSizeToFit). No blinking caret; the
 * keypad is the "cursor". An optional scan-receipt button appears below, subtle
 * and secondary.
 *
 * No TextInput — no system keyboard ever appears.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AmountExpr, displayString } from '../../domain/amountExpression';

interface AmountDisplayProps {
  expr: AmountExpr;
  currency?: string;
  onScanReceipt?: () => void;
}

export function AmountDisplay({
  expr,
  currency = 'SGD',
  onScanReceipt,
}: AmountDisplayProps) {
  const text = displayString(expr);

  return (
    <View
      className="items-center justify-center"
      style={{ flex: 1, minHeight: 120, paddingVertical: 22, gap: 12 }}
    >
      {/* Currency badge — outline style, centered above amount */}
      <View className="bg-surfaceAlt border border-border rounded-pill px-3 py-1">
        <Text className="text-muted text-xs font-semibold">{currency}</Text>
      </View>

      {/* Amount figure */}
      <Text
        className="text-text font-extrabold"
        style={{ fontSize: 52, letterSpacing: -1, lineHeight: 56 }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.4}
      >
        {text}
      </Text>

      {/* Scan receipt — secondary, only when provided */}
      {onScanReceipt && (
        <Pressable
          onPress={onScanReceipt}
          accessibilityLabel="Scan receipt"
          className="flex-row items-center"
          style={{ gap: 6 }}
        >
          <Feather name="camera" size={14} color="#9AA4B2" />
          <Text className="text-muted text-xs">Scan receipt</Text>
        </Pressable>
      )}
    </View>
  );
}
