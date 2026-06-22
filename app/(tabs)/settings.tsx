/**
 * Settings — backup/restore, security, and subscription entry points.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { signOut } from '../../src/features/auth/repository';
import {
  getCurrency,
  setCurrency,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
} from '../../src/features/settings/repository';

export default function SettingsScreen() {
  const router = useRouter();
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);

  useFocusEffect(
    useCallback(() => {
      getCurrency().then(setCurrencyState);
    }, [])
  );

  const onPickCurrency = async (code: string) => {
    setCurrencyState(code);
    await setCurrency(code);
  };

  const onSignOut = () =>
    Alert.alert('Sign out', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-text text-[28px] font-extrabold mb-4">Settings</Text>

      <SectionLabel>Accounts</SectionLabel>
      <Row
        icon="credit-card"
        label="Manage accounts"
        onPress={() => router.push('/manage-accounts')}
      />

      <SectionLabel>Preferences</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        <Text className="text-text text-base mb-3">Currency</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {SUPPORTED_CURRENCIES.map((code) => {
            const active = code === currency;
            return (
              <Pressable
                key={code}
                onPress={() => onPickCurrency(code)}
                className={`rounded-pill px-4 py-2 ${active ? 'bg-primary' : 'bg-surfaceAlt'}`}
              >
                <Text className={active ? 'text-white text-[13px] font-semibold' : 'text-muted text-[13px]'}>
                  {code}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="text-muted text-xs mt-3">
          One currency for the whole app — there's no per-account currency and no
          conversion.
        </Text>
      </View>

      <SectionLabel>Data</SectionLabel>
      <Row
        icon="download"
        label="Export encrypted backup"
        onPress={() => Alert.alert('Backup', 'Encrypted export — wired in src/lib/backup.ts')}
      />
      <Row
        icon="upload"
        label="Restore from backup"
        onPress={() => Alert.alert('Restore', 'Decrypt + import an existing backup')}
      />

      <SectionLabel>Security</SectionLabel>
      <Row icon="lock" label="Require Face ID on launch" onPress={() => {}} />
      <Row icon="log-out" label="Sign out" tone="negative" onPress={onSignOut} />

      <SectionLabel>ProjectXavier Premium</SectionLabel>
      <Row
        icon="star"
        label="Upgrade — unlimited AI, receipt scan, sync"
        onPress={() => Alert.alert('Premium', 'Subscriptions via RevenueCat (Phase 4)')}
      />
    </ScrollView>
  );
}

function Row({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  tone?: 'negative';
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5"
      onPress={onPress}
    >
      <Feather name={icon} size={18} color={tone === 'negative' ? '#F2637E' : '#9AA4B2'} />
      <Text className={tone === 'negative' ? 'text-negative text-base' : 'text-text text-base'}>
        {label}
      </Text>
      <Feather name="chevron-right" size={18} color="#9AA4B2" style={{ marginLeft: 'auto' }} />
    </Pressable>
  );
}
