/**
 * BYOK (bring-your-own-key) settings — docs/design/byok-spec.md. Lets the
 * user opt into parsing with their own OpenAI/Anthropic account: an enable
 * toggle, provider picker, obscured key field, editable model field, a
 * "Test key" round-trip, and "Remove key" (which deletes the Keychain entry
 * itself, not just the flag). Reached from Settings → Assistant → BYOK.
 *
 * The key is NEVER re-displayed once saved — only whether one is currently
 * saved (`hasByokKey`). Pasting a new value and pressing "Save key" is the
 * only way to change it; the field is cleared immediately after a
 * successful save so the plaintext key doesn't linger in this screen's
 * state any longer than necessary.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Button } from '../../src/components/ui/Button';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { ByokProvider } from '../../src/domain/parseRouter';
import {
  getByokEnabled,
  setByokEnabled,
  getByokProvider,
  setByokProvider,
  getByokModel,
  setByokModel,
  DEFAULT_BYOK_MODEL,
} from '../../src/features/settings/repository';
import { getByokKey, hasByokKey, setByokKey, deleteByokKey } from '../../src/features/ai/byokKey';
import { testByokKey, TestKeyResult } from '../../src/features/ai/testKey';

const PROVIDERS: ByokProvider[] = ['openai', 'anthropic'];
const PROVIDER_LABEL: Record<ByokProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export default function ByokSettingsScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [enabled, setEnabledState] = useState(false);
  const [provider, setProviderState] = useState<ByokProvider>('openai');
  const [model, setModelState] = useState(DEFAULT_BYOK_MODEL.openai);
  const [keySaved, setKeySaved] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testResult, setTestResult] = useState<TestKeyResult | null>(null);
  const [testing, setTesting] = useState(false);

  const loadProvider = useCallback(async (p: ByokProvider) => {
    const [m, hasKey] = await Promise.all([getByokModel(p), hasByokKey(p)]);
    setModelState(m);
    setKeySaved(hasKey);
    setKeyInput('');
    setTestResult(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [on, p] = await Promise.all([getByokEnabled(), getByokProvider()]);
        const resolvedProvider = p ?? 'openai';
        setEnabledState(on);
        setProviderState(resolvedProvider);
        await loadProvider(resolvedProvider);
      })();
    }, [loadProvider]),
  );

  const onToggleEnabled = async (v: boolean) => {
    setEnabledState(v);
    await setByokEnabled(v);
  };

  const onPickProvider = async (p: ByokProvider) => {
    setProviderState(p);
    await setByokProvider(p);
    await loadProvider(p);
  };

  const onModelEndEditing = async () => {
    const trimmed = model.trim();
    const value = trimmed.length > 0 ? trimmed : DEFAULT_BYOK_MODEL[provider];
    setModelState(value);
    await setByokModel(provider, value);
  };

  const onSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setSavingKey(true);
    try {
      await setByokKey(provider, trimmed);
      setKeySaved(true);
      setKeyInput('');
      setTestResult(null);
    } finally {
      setSavingKey(false);
    }
  };

  const onRemoveKey = () => {
    Alert.alert('Remove key?', `This deletes your saved ${PROVIDER_LABEL[provider]} key from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await deleteByokKey(provider);
            setKeySaved(false);
            setTestResult(null);
          })(),
      },
    ]);
  };

  const onTestKey = async () => {
    // Test whatever is currently pasted in the field; if nothing is pasted,
    // fall back to the saved key by re-reading it (never re-displayed, but
    // still usable for a round-trip check).
    const candidate = keyInput.trim();
    if (!candidate && !keySaved) return;
    setTesting(true);
    setTestResult(null);
    try {
      const key = candidate || (await getByokKey(provider));
      if (!key) {
        setTestResult('invalid');
        return;
      }
      const result = await testByokKey(provider, key, model);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}
    >
      <Pressable onPress={() => router.back()} className="mb-4 self-start">
        <Feather name="arrow-left" size={22} color={c.muted} />
      </Pressable>
      <Text className="text-text text-[28px] font-extrabold mb-1">Bring your own key</Text>
      <Text className="text-muted text-sm mb-6">
        Parse expenses with your own OpenAI or Anthropic account instead of (or
        ahead of) the on-device assistant.
      </Text>

      <SectionLabel>Enable</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center">
        <View className="flex-1">
          <Text className="text-text text-base">Use my own key</Text>
          <Text className="text-muted text-xs mt-0.5">
            Off by default. When on, this provider parses first, falling back
            to on-device/offline parsing automatically if it fails or you're
            offline.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => void onToggleEnabled(v)}
          thumbColor="#fff"
          trackColor={{ false: c.grabHandle, true: c.primary }}
          accessibilityLabel="Use my own key"
        />
      </View>

      <SectionLabel>Provider</SectionLabel>
      <View className="mb-2.5">
        <SegmentedControl options={PROVIDERS} value={provider} onChange={(p) => void onPickProvider(p)} />
      </View>

      <SectionLabel>{PROVIDER_LABEL[provider]} API key</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        <Text className="text-muted text-xs mb-2">
          {keySaved ? 'A key is saved on this device.' : 'No key saved yet.'}
        </Text>
        <TextInput
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={keySaved ? 'Paste a new key to replace it' : 'Paste your API key'}
          placeholderTextColor={c.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-surfaceAlt border border-border rounded-md px-3 py-2.5 text-text text-[13px] mb-3"
        />
        <View className="flex-row" style={{ gap: 10 }}>
          <Button
            title={savingKey ? 'Saving…' : 'Save key'}
            variant="primary"
            onPress={() => void onSaveKey()}
            disabled={savingKey || keyInput.trim().length === 0}
            className={`flex-1 ${savingKey || keyInput.trim().length === 0 ? 'opacity-50' : ''}`}
          />
          <Button
            title="Remove key"
            variant="ghost"
            onPress={onRemoveKey}
            disabled={!keySaved}
            className={`flex-1 ${!keySaved ? 'opacity-50' : ''}`}
          />
        </View>
      </View>

      <SectionLabel>Model</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        <TextInput
          value={model}
          onChangeText={setModelState}
          onEndEditing={() => void onModelEndEditing()}
          placeholder={DEFAULT_BYOK_MODEL[provider]}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-surfaceAlt border border-border rounded-md px-3 py-2.5 text-text text-[13px]"
        />
      </View>

      <SectionLabel>Test key</SectionLabel>
      <Pressable
        className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center gap-3"
        onPress={() => void onTestKey()}
        disabled={testing || (!keyInput.trim() && !keySaved)}
        accessibilityRole="button"
        accessibilityLabel="Test key"
      >
        <Feather name="zap" size={18} color={c.muted} />
        <Text className="text-text text-base flex-1">
          {testing ? 'Testing…' : 'Test key'}
        </Text>
      </Pressable>
      {testResult && (
        <Text
          className={`text-sm mb-4 mx-1 ${testResult === 'ok' ? 'text-positive' : 'text-negative'}`}
        >
          {testResult === 'ok'
            ? 'Key works — a test parse succeeded.'
            : testResult === 'invalid'
              ? 'That key was rejected by the provider — double-check it.'
              : "Couldn't reach the provider — check your connection and try again."}
        </Text>
      )}

      <Text className="text-muted text-xs mx-1 mt-2">
        When on, the text you enter is sent to {PROVIDER_LABEL[provider]} using
        your key. Xavier never sees your key or your entries.
      </Text>
    </ScrollView>
  );
}
