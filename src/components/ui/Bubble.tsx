import React from 'react';
import { View, Text } from 'react-native';
import { cn } from './cn';

/** Chat bubble — `ai` (left) or `me` (right). */
export function Bubble({
  from,
  children,
}: {
  from: 'ai' | 'me';
  children: React.ReactNode;
}) {
  const me = from === 'me';
  return (
    <View
      className={cn(
        'max-w-[82%] rounded-[18px] px-3.5 py-2.5',
        me
          ? 'self-end bg-primary rounded-br-md'
          : 'self-start bg-surface border border-border rounded-bl-md'
      )}
    >
      <Text className={cn('text-[15px] leading-5', me ? 'text-white' : 'text-text')}>
        {children}
      </Text>
    </View>
  );
}
