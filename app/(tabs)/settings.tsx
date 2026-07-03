/**
 * Settings — backup/restore, security, and subscription entry points.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { colors } from '../../src/theme/tokens';
import { METRICS_ENABLED } from '../../src/lib/flags';
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
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [avatarLook, setAvatarLookState] = useState(DEFAULT_AVATAR_LOOK);
  const [avatarKind, setAvatarKindState] = useState<string>(DEFAULT_AVATAR_KIND);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toUpperCase();
    if (!q) return SUPPORTED_CURRENCIES;
    return SUPPORTED_CURRENCIES.filter((c) => c.includes(q));
  }, [currencySearch]);

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
        <Pressable
          onPress={() => { setCurrencyOpen((v) => !v); setCurrencySearch(''); }}
          className="flex-row items-center gap-3"
          accessibilityRole="button"
          accessibilityState={{ expanded: currencyOpen }}
          accessibilityLabel="Currency"
        >
          <View className="flex-1">
            <Text className="text-text text-base">Currency</Text>
            <Text className="text-muted text-xs mt-0.5">{currency}</Text>
          </View>
          <Feather name={currencyOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </Pressable>

        {currencyOpen && (
          <View className="mt-4">
            <TextInput
              value={currencySearch}
              onChangeText={setCurrencySearch}
              placeholder="Search…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              className="bg-surfaceAlt border border-border rounded-md px-3 py-2 text-text text-[13px] mb-3"
            />
            <View className="border border-border rounded-md overflow-hidden">
              {filteredCurrencies.map((code, i) => {
                const active = code === currency;
                return (
                  <Pressable
                    key={code}
                    onPress={() => onPickCurrency(code)}
                    className={`flex-row items-center justify-between px-3.5 py-3 ${
                      i > 0 ? 'border-t border-border' : ''
                    } ${active ? 'bg-surfaceAlt' : ''}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text className={`text-[14px] ${active ? 'text-text font-semibold' : 'text-text'}`}>
                      {code}
                    </Text>
                    {active && <Feather name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
              {filteredCurrencies.length === 0 && (
                <Text className="text-muted text-[13px] px-3.5 py-3">No matching currency.</Text>
              )}
            </View>
            <Text className="text-muted text-xs mt-3">
              One currency for the whole app — there's no per-account currency and no
              conversion.
            </Text>
          </View>
        )}
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
          <Feather name={avatarOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
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
                <Feather name="check" size={16} color={colors.primary} />
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
        icon="hard-drive"
        label="Backups"
        onPress={() => router.push('/backups')}
      />

      <SectionLabel>Security</SectionLabel>
      <Row icon="lock" label="Require Face ID on launch" onPress={() => {}} />
      <Row icon="log-out" label="Sign out" tone="negative" onPress={onSignOut} />

      {METRICS_ENABLED && (
        <>
          <SectionLabel>Developer</SectionLabel>
          <Row
            icon="activity"
            label="Parse metrics"
            onPress={() => router.push('/debug-metrics')}
          />
          <Row
            icon="eye"
            label="Avatar preview"
            onPress={() => router.push('/debug-avatar')}
          />
        </>
      )}

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
        <Circle cx="38" cy="42" r="7" fill={colors.bg} />
        <Circle cx="62" cy="42" r="7" fill={colors.bg} />
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
      <Feather name={icon} size={18} color={tone === 'negative' ? colors.negative : colors.textMuted} />
      <Text className={tone === 'negative' ? 'text-negative text-base' : 'text-text text-base'}>
        {label}
      </Text>
      <Feather name="chevron-right" size={18} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
    </Pressable>
  );
}
