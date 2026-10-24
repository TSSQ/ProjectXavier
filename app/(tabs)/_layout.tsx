import React from 'react';
import { NativeTabs } from 'expo-router/native-tabs';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { PeriodProvider } from '../../src/context/PeriodContext';

export default function TabsLayout() {
  const c = useThemeColors();
  return (
    <PeriodProvider>
      {/*
       * Phase 2 (docs/design/glass-phase2-spec.md §4.1, decision D1):
       * `NativeTabs` hands the bar to a real `UITabBarController` — the OS
       * owns its material, geometry and safe area, and content travels
       * underneath it (the Liquid Glass look). Our own floating glass tab
       * bar POC was `position: absolute` in both tiers and hid the
       * Assistant composer entirely; this replaces it, not extends it.
       *
       * `minimizeBehavior="onScrollDown"` is iOS 26's own shrink-on-scroll —
       * free with NativeTabs, not something we implement.
       */}
      <NativeTabs minimizeBehavior="onScrollDown" tintColor={c.primary}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf={{ default: 'sparkles', selected: 'sparkles' }} />
          <NativeTabs.Trigger.Label>Assistant</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="dashboard">
          <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} />
          <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="transactions">
          <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet', selected: 'list.bullet' }} />
          <NativeTabs.Trigger.Label>Transactions</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </PeriodProvider>
  );
}
