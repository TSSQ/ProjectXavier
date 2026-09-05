import React from 'react';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
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
          <Icon sf={{ default: 'sparkles', selected: 'sparkles' }} />
          <Label>Assistant</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="dashboard">
          <Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} />
          <Label>Dashboard</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="transactions">
          <Icon sf={{ default: 'list.bullet', selected: 'list.bullet' }} />
          <Label>Transactions</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
          <Label>Settings</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </PeriodProvider>
  );
}
