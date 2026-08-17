import React from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { icons } from '../../src/theme/assets';
import { PeriodProvider } from '../../src/context/PeriodContext';
import { GlassTabBar } from '../../src/components/ui/GlassTabBar';

export default function TabsLayout() {
  const c = useThemeColors();
  return (
    <PeriodProvider>
    <Tabs
      // POC: a floating Liquid Glass bar (src/components/ui/GlassTabBar.tsx)
      // replaces the stock opaque tab bar. It renders ABSOLUTELY over the
      // content, so screens whose own content runs to the bottom will sit
      // under it — that is the point of the App Store look, but it means
      // per-screen bottom padding is the next thing to check.
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color, size }) => (
            <Feather name={icons.home} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Feather name={icons.dashboard} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color, size }) => (
            <Feather name={icons.transactions} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Feather name={icons.settings} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
    </PeriodProvider>
  );
}
