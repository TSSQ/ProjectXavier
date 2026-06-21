import React from 'react';
import { Text } from 'react-native';

/** Uppercase muted section heading (e.g. "Assets", "Today"). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mt-2 mb-2.5">
      {children}
    </Text>
  );
}
