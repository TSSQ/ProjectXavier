import React from 'react';
import { View, ViewProps } from 'react-native';
import { cn } from './cn';

/** Elevated surface container. */
export function Card({ className, ...rest }: ViewProps) {
  return (
    <View
      className={cn('bg-surface border border-border rounded-md p-4', className)}
      {...rest}
    />
  );
}
