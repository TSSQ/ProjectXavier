/**
 * AmountDisplay — shows the current amount expression as large text with a
 * blinking caret, plus a currency pill and an optional receipt-scan button.
 *
 * No TextInput is used here — no system keyboard ever appears.
 */
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
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
  const caretOpacity = useSharedValue(1);

  useEffect(() => {
    caretOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(1, { duration: 500 }),
        withTiming(0, { duration: 100 }),
        withTiming(0, { duration: 400 }),
      ),
      -1,
      false,
    );
  }, [caretOpacity]);

  const caretStyle = useAnimatedStyle(() => ({
    opacity: caretOpacity.value,
  }));

  const text = displayString(expr);

  return (
    <View className="items-center py-4 px-4">
      {/* Top row: currency pill + scan button */}
      <View className="flex-row items-center justify-between w-full mb-3">
        <View className="bg-surfaceAlt border border-border rounded-pill px-3 py-1">
          <Text className="text-muted text-xs font-semibold">{currency}</Text>
        </View>
        {onScanReceipt && (
          <Pressable
            onPress={onScanReceipt}
            accessibilityLabel="Scan receipt"
            className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
          >
            <Feather name="camera" size={16} color="#9AA4B2" />
          </Pressable>
        )}
      </View>

      {/* Amount text + blinking caret */}
      <View className="flex-row items-center">
        <Text
          className="text-text font-bold"
          style={{ fontSize: 40, letterSpacing: -1 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {text}
        </Text>
        <Animated.View
          style={[
            {
              width: 2,
              height: 42,
              backgroundColor: '#5B8DEF',
              borderRadius: 1,
              marginLeft: 2,
            },
            caretStyle,
          ]}
        />
      </View>
    </View>
  );
}
