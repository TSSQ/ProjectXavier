import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { cn } from './cn';

/** A row with an optional icon chip, title/subtitle, and a right-aligned value. */
export function ListRow({
  icon,
  iconClassName = 'bg-surfaceAlt',
  title,
  subtitle,
  value,
  tone,
  onPress,
}: {
  icon?: string;
  iconClassName?: string;
  title: string;
  subtitle?: string;
  value?: string;
  tone?: 'positive' | 'negative';
  onPress?: () => void;
}) {
  const content = (
    <>
      {icon ? (
        <View
          className={cn(
            'w-10 h-10 rounded-xl items-center justify-center',
            iconClassName
          )}
        >
          <Text className="text-lg">{icon}</Text>
        </View>
      ) : null}
      <View className="flex-1">
        <Text className="text-text text-sm font-semibold">{title}</Text>
        {subtitle ? (
          <Text className="text-muted text-xs mt-0.5">{subtitle}</Text>
        ) : null}
      </View>
      {value ? (
        <Text
          className={cn(
            'text-[15px] font-bold',
            tone === 'positive' && 'text-positive',
            tone === 'negative' && 'text-negative',
            !tone && 'text-text'
          )}
        >
          {value}
        </Text>
      ) : null}
    </>
  );

  const className =
    'flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5';

  return onPress ? (
    <Pressable className={className} onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  );
}
