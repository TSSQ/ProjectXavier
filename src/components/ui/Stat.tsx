import React from 'react';
import { View, Text } from 'react-native';
import { cn } from './cn';

/** Labelled figure tile (e.g. Assets / Liabilities). */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <View className="flex-1 bg-surface border border-border rounded-md p-4">
      <Text className="text-muted text-xs font-semibold">{label}</Text>
      <Text
        className={cn(
          'text-lg font-bold mt-1.5',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-text'
        )}
      >
        {value}
      </Text>
    </View>
  );
}
