import React from 'react';
import { Pressable, PressableProps, Text, ActivityIndicator } from 'react-native';
import { cn } from './cn';

type Variant = 'primary' | 'ghost';

export function Button({
  title,
  variant = 'primary',
  loading = false,
  className,
  ...rest
}: PressableProps & { title: string; variant?: Variant; loading?: boolean }) {
  return (
    <Pressable
      className={cn(
        'rounded-pill py-3 items-center justify-center',
        variant === 'primary' ? 'bg-primary' : 'bg-surfaceAlt',
        className
      )}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text
          className={cn(
            'text-base font-bold',
            variant === 'primary' ? 'text-white' : 'text-text'
          )}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
