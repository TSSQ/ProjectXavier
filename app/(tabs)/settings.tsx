/**
 * Settings — backup/restore, security, and subscription entry points.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { signOut } from '../../src/features/auth/repository';
import {
  getCurrency,
  setCurrency,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  getAvatarLook,
  setAvatarLook,
  getAvatarKind,
  setAvatarKind,
} from '../../src/features/settings/repository';
import {
  AVATAR_LOOKS,
  lookById,
  DEFAULT_AVATAR_LOOK,
  AvatarLook,
  AVATAR_KINDS,
  kindById,
  DEFAULT_AVATAR_KIND,
} from '../../src/domain/avatar';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [avatarLook, setAvatarLookState] = useState(DEFAULT_AVATAR_LOOK);
  const [avatarKind, setAvatarKindState] = useState<string>(DEFAULT_AVATAR_KIND);
  const [avatarOpen, setAvatarOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getCurrency().then(setCurrencyState);
      getAvatarLook().then((id) => setAvatarLookState(lookById(id).id));
      getAvatarKind().then((id) => setAvatarKindState(kindById(id).id));
    }, [])
  );

  const onPickCurrency = async (code: string) => {
    setCurrencyState(code);
    await setCurrency(code);
  };

  const onPickAvatar = async (id: string) => {
    setAvatarLookState(id);
    await setAvatarLook(id);
  };

  const onPickKind = async (id: string) => {
    // Only available kinds are selectable; guard anyway.
    if (!AVATAR_KINDS.find((k) => k.id === id && k.available)) return;
    setAvatarKindState(id);
    await setAvatarKind(id);
  };

  const onSignOut = () =>
    Alert.alert('Sign out', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12 }}>
      <Text className="text-text text-[28px] font-extrabold mb-4">Settings</Text>

      <SectionLabel>Accounts</SectionLabel>
      <Row
        icon="credit-card"
        label="Manage accounts"
        onPress={() => router.push('/manage-accounts')}
      />
      <Row
        icon="tag"
        label="Manage categories"
        onPress={() => router.push('/manage-categories')}
      />
      <Row
        icon="users"
        label="Manage payees"
        onPress={() => router.push('/manage-payees')}
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

      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        {/* Tap the header to fold/unfold the avatar controls — keeps the
            Settings list compact until the user wants to customise it. */}
        <Pressable
          onPress={() => setAvatarOpen((v) => !v)}
          className="flex-row items-center gap-3"
          accessibilityRole="button"
          accessibilityState={{ expanded: avatarOpen }}
          accessibilityLabel="Assistant avatar"
        >
          <AvatarSwatch look={lookById(avatarLook)} selected={false} size={28} />
          <View className="flex-1">
            <Text className="text-text text-base">Assistant avatar</Text>
            <Text className="text-muted text-xs mt-0.5">
              {kindById(avatarKind).label}
              {avatarKind === 'blob' ? ` · ${lookById(avatarLook).label}` : ''}
            </Text>
          </View>
          <Feather name={avatarOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#9AA4B2" />
        </Pressable>

        {avatarOpen && (
        <View className="mt-4">
        {/* Style = avatar KIND. Blob is the default; other kinds are placeholders
            until their renderers ship (see components/avatars/registry). */}
        <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mb-2">
          Style
        </Text>
        {AVATAR_KINDS.map((k) => {
          const active = k.id === avatarKind;
          return (
            <Pressable
              key={k.id}
              onPress={() => onPickKind(k.id)}
              disabled={!k.available}
              className={`flex-row items-center gap-3 rounded-md px-3 py-2.5 mb-1.5 border ${
                active ? 'border-primary bg-surfaceAlt' : 'border-border bg-surface'
              } ${k.available ? '' : 'opacity-55'}`}
              accessibilityLabel={`Avatar style ${k.label}`}
            >
              <View className="flex-1">
                <Text className="text-text text-[13px] font-bold">{k.label}</Text>
                <Text className="text-muted text-[10px] mt-0.5">{k.description}</Text>
              </View>
              {active ? (
                <Feather name="check" size={16} color="#5B8DEF" />
              ) : !k.available ? (
                <Text className="text-[9px] font-bold text-[#8aa0c8] border border-border rounded-pill px-2 py-0.5 uppercase">
                  Soon
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {/* Variant picker for the blob kind = its colour looks. */}
        {avatarKind === 'blob' && (
          <>
            <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mt-3 mb-2">
              Blob colour
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 14 }}>
              {AVATAR_LOOKS.map((look) => (
                <Pressable
                  key={look.id}
                  onPress={() => onPickAvatar(look.id)}
                  className="items-center"
                  style={{ width: 56 }}
                  accessibilityLabel={`Avatar ${look.label}`}
                >
                  <AvatarSwatch look={look} selected={look.id === avatarLook} />
                  <Text
                    className={`text-[11px] mt-1.5 ${look.id === avatarLook ? 'text-text font-bold' : 'text-muted'}`}
                  >
                    {look.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        </View>
        )}
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

function AvatarSwatch({ look, selected, size }: { look: AvatarLook; selected: boolean; size?: number }) {
  const d = size ?? 46;
  return (
    <View
      className={`rounded-full items-center justify-center ${selected ? 'border-2 border-primary' : 'border border-border'}`}
      style={{ width: d + 8, height: d + 8 }}
    >
      <Svg width={d} height={d} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`sw-${look.id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={look.from} />
            <Stop offset="1" stopColor={look.to} />
          </LinearGradient>
        </Defs>
        <Circle cx="50" cy="50" r="46" fill={`url(#sw-${look.id})`} />
        <Circle cx="38" cy="42" r="7" fill="#0E1116" />
        <Circle cx="62" cy="42" r="7" fill="#0E1116" />
      </Svg>
    </View>
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
