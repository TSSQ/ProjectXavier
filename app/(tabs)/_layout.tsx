import React from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { icons } from '../../src/theme/assets';
import { PeriodProvider } from '../../src/context/PeriodContext';

export default function TabsLayout() {
  const c = useThemeColors();
  return (
    <PeriodProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
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
