/**
 * BYOK (bring-your-own-key) settings — docs/design/byok-spec.md. Lets the
 * user opt into parsing with their own OpenAI/Anthropic account: an enable
 * toggle, provider picker, obscured key field, editable model field, a
 * "Test key" round-trip, and "Remove key" (which deletes the Keychain entry
 * itself, not just the flag). Reached from Settings → Assistant → BYOK.
 *
 * Saved-key card (docs/design/byok-saved-key-card-spec.md): once a key is
 * saved, the API-key section state-swaps from the obscured input to a
 * "Key saved" card showing only a masked hint (`maskApiKey` — last 4 chars,
 * everything else a constant run of dots; the full key is NEVER rendered).
 * "Replace key" swaps back to the input to paste a new value; a verified
 * save clears the input immediately (the plaintext key never lingers in
 * this screen's state longer than necessary) and briefly flashes a
 * "✓ Key saved" confirmation.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Button } from '../../src/components/ui/Button';
import { ModelPickerSheet } from '../../src/components/ui/ModelPickerSheet';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { ByokProvider } from '../../src/domain/parseRouter';
import { ModelChoice, isKnownModel, shouldApplyModelsResult } from '../../src/domain/byokModels';
import {
  getByokEnabled,
  setByokEnabled,
  getByokProvider,
  setByokProvider,
  getByokModel,
  setByokModel,
  DEFAULT_BYOK_MODEL,
} from '../../src/features/settings/repository';
import { getByokKey, setByokKey, deleteByokKey } from '../../src/features/ai/byokKey';
import { listByokModels } from '../../src/features/ai/listModels';
import { testByokKey, TestKeyResult } from '../../src/features/ai/testKey';
import { maskApiKey } from '../../src/domain/byokKeyMask';

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
  const [savedKeyHint, setSavedKeyHint] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestKeyResult | null>(null);
  const [testing, setTesting] = useState(false);

  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<'invalid' | 'network' | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Generation counter: only the most recently issued loadModels/onSaveKey/
  // onRemoveKey call is allowed to apply its result, so a slow round-trip
  // that resolves after a newer one was issued (e.g. after a provider switch,
  // a new save, or a key removal — all of which bump this token) can't
  // clobber the newer state (docs/design/byok-model-picker-spec.md QA fix;
  // extended to save/remove per docs/design/byok-keychain-persist-spec.md QA
  // follow-up — a stale-provider race could otherwise overwrite `keySaved`/
  // `saveError` for the provider the user has since switched to).
  const requestTokenRef = useRef(0);

  // Save-moment flash timer: cleared on unmount, and its clear-setState is
  // itself guarded by `isLatest()` (the token captured when the flash was
  // triggered) so a stale timer firing after a provider switch/newer save
  // can never clobber the flash state of whatever the user has since done.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const FLASH_DURATION_MS = 1800;

  /** Show the brief "✓ Key saved" flash for a verified save, then auto-clear
   *  it — but only if `isLatest` (the save's own token guard) still holds
   *  once the timer fires, so a provider switch/newer save in the meantime
   *  can never have this stale timer clobber its state. */
  const flashSaved = (isLatest: () => boolean) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setJustSaved(true);
    flashTimerRef.current = setTimeout(() => {
      if (isLatest()) setJustSaved(false);
      flashTimerRef.current = null;
    }, FLASH_DURATION_MS);
  };

  /** Cancel any pending save-moment flash and hide it immediately — used by
   *  Replace/Cancel so an unrelated action in between can't let a stale
   *  timer resurrect the "✓ Key saved" flash once the card reappears. */
  const clearFlash = () => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setJustSaved(false);
  };

  const loadModels = useCallback(async (p: ByokProvider) => {
    const token = ++requestTokenRef.current;
    const isLatest = () =>
      shouldApplyModelsResult({ requestToken: token, latestToken: requestTokenRef.current });

    const key = await getByokKey(p);
    if (!key) {
      if (isLatest()) {
        setModels(null);
        setModelsError(null);
      }
      return;
    }
    if (isLatest()) setModelsLoading(true);
    try {
      const result = await listByokModels(p, key);
      if (!isLatest()) return;
      if (result.ok) {
        setModels(result.models);
        setModelsError(null);
      } else {
        setModels(null);
        setModelsError(result.reason);
      }
    } finally {
      if (isLatest()) setModelsLoading(false);
    }
  }, []);

  const loadProvider = useCallback(
    async (p: ByokProvider) => {
      // Bump unconditionally (not just inside loadModels below) so any
      // in-flight onSaveKey/onRemoveKey for the previous provider becomes
      // stale even when the newly-selected provider has no key yet (loadModels
      // wouldn't otherwise be called in that case).
      const token = ++requestTokenRef.current;
      const isLatest = () => token === requestTokenRef.current;
      const [m, key] = await Promise.all([getByokModel(p), getByokKey(p)]);
      // Match hasByokKey's predicate (non-empty after trim) so "is a key
      // present?" reads the same here as everywhere else (src/features/ai/
      // byokKey.ts) — a whitespace-only value can't be persisted via this UI,
      // but keep the two checks consistent.
      const hasKey = !!key && key.trim().length > 0;
      if (isLatest()) {
        setModelState(m);
        setKeySaved(hasKey);
        setSavedKeyHint(key ? maskApiKey(key) : null);
        setReplacing(false);
        setJustSaved(false);
        setKeyInput('');
        setTestResult(null);
        setSaveError(null);
        setUseCustom(false);
        setModels(null);
        setModelsError(null);
      }
      if (hasKey) {
        await loadModels(p);
      }
    },
    [loadModels]
  );

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

  const onSelectModel = async (choice: ModelChoice) => {
    setModelState(choice.id);
    setUseCustom(false);
    await setByokModel(provider, choice.id);
  };

  const onSelectCustom = () => {
    setUseCustom(true);
  };

  const onSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    const p = provider;
    // Captured at call start: only this call applying its result is allowed
    // if `requestTokenRef.current` still matches once the Keychain round-trip
    // resolves — otherwise the user has since switched provider (or fired a
    // newer save/remove/loadModels) and this result is stale.
    const token = ++requestTokenRef.current;
    const isLatest = () => token === requestTokenRef.current;
    setSavingKey(true);
    setSaveError(null);
    try {
      await setByokKey(p, trimmed);
      if (!isLatest()) return;
      const hint = maskApiKey(trimmed);
      setSavedKeyHint(hint);
      setKeySaved(true);
      setReplacing(false);
      setKeyInput('');
      setTestResult(null);
      flashSaved(isLatest);
      await loadModels(p);
    } catch {
      // Any failure — a typed ByokKeyPersistError or anything else the
      // Keychain call could throw — is treated uniformly as a save failure;
      // never rethrown into this void-discarded async (that would be an
      // unhandled rejection with zero visible error), and never logs key
      // material.
      if (isLatest()) {
        setSaveError("Couldn't save your key to this device — please try again.");
      }
    } finally {
      // Unlike the result-applying state above, `savingKey` isn't
      // per-provider — it's just "is the Save button's spinner showing" —
      // so it must always clear here, even for a stale call, or a
      // provider switch mid-save would leave the button stuck on "Saving…"
      // forever.
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
            const p = provider;
            // Invalidate any in-flight loadModels/onSaveKey so they can't
            // clobber this removal (or vice versa if the provider changes
            // again before this resolves — see `isLatest` below).
            const token = ++requestTokenRef.current;
            const isLatest = () => token === requestTokenRef.current;
            try {
              await deleteByokKey(p);
              if (!isLatest()) return;
              setKeySaved(false);
              setSavedKeyHint(null);
              setReplacing(false);
              setTestResult(null);
              setSaveError(null);
              setModels(null);
              setModelsError(null);
              setUseCustom(false);
            } catch {
              // Same key-free, non-throwing handling as onSaveKey — a
              // deleteByokKey failure must surface, not vanish as an
              // unhandled rejection.
              if (isLatest()) {
                setSaveError("Couldn't remove your key from this device — please try again.");
              }
            }
          })(),
      },
    ]);
  };

  const onReplaceKey = () => {
    setReplacing(true);
    setSaveError(null);
    clearFlash();
  };

  const onCancelReplace = () => {
    setReplacing(false);
    setKeyInput('');
    setSaveError(null);
    clearFlash();
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

  // The currently-saved model's display label — falls back to the raw id
  // when it isn't among the fetched models (a custom id, or the list hasn't
  // loaded yet), so a saved choice is never silently reset.
  const selectedLabel = useMemo(() => {
    if (!models || !isKnownModel(models, model)) return model;
    return models.find((m) => m.id === model)!.label;
  }, [models, model]);

  // Manual entry is required (rather than the picker) whenever there's no
  // fetched list to pick from, or the user explicitly asked for it.
  const showCustomField = !keySaved || modelsError !== null || useCustom;

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

      {/* A saved key does nothing until the toggle above is on — an easy step
          to miss after saving + testing a key + picking a model. Surface it
          inline (accent border + up-arrow at the toggle) whenever a key is
          saved for this provider but BYOK is still off, so the last step is
          obvious. Enabling stays explicit (we never auto-flip the toggle). */}
      {keySaved && !enabled && (
        <View
          className="bg-surface border rounded-md px-4 py-3 mb-2.5 flex-row items-center"
          style={{ gap: 10, borderColor: c.primary }}
          accessibilityRole="alert"
        >
          <Feather name="arrow-up" size={18} color={c.primary} />
          <Text className="text-text text-xs flex-1">
            Your {PROVIDER_LABEL[provider]} key is saved, but not in use yet —
            turn on “Use my own key” above to start parsing with it.
          </Text>
        </View>
      )}

      <SectionLabel>Provider</SectionLabel>
      <View className="mb-2.5">
        <SegmentedControl options={PROVIDERS} value={provider} onChange={(p) => void onPickProvider(p)} />
      </View>

      <SectionLabel>{PROVIDER_LABEL[provider]} API key</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        {keySaved && !replacing ? (
          <>
            <View className="flex-row items-center mb-1" style={{ gap: 8 }}>
              <Feather name="check-circle" size={18} color={c.positive} />
              <Text className="text-text text-base font-bold">Key saved</Text>
            </View>
            {savedKeyHint && (
              <Text className="text-muted text-xs mb-3" accessibilityLabel="Saved key hint">
                {savedKeyHint}
              </Text>
            )}
            {justSaved && (
              <Text className="text-positive text-xs mb-3" accessibilityLabel="Key saved confirmation">
                ✓ Key saved
              </Text>
            )}
            <View className="flex-row" style={{ gap: 10 }}>
              <Button title="Replace key" variant="ghost" onPress={onReplaceKey} className="flex-1" />
              <Button title="Remove key" variant="ghost" onPress={onRemoveKey} className="flex-1" />
            </View>
          </>
        ) : (
          <>
            {!keySaved && <Text className="text-muted text-xs mb-2">No key saved yet.</Text>}
            <TextInput
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="Paste your API key"
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
              {replacing && (
                <Button title="Cancel" variant="ghost" onPress={onCancelReplace} className="flex-1" />
              )}
            </View>
            {saveError && (
              <Text className="text-negative text-xs mt-2" accessibilityLabel="Save key error">
                {saveError}
              </Text>
            )}
          </>
        )}
      </View>

      <SectionLabel>Model</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5">
        {!keySaved && (
          <Text className="text-muted text-xs mb-2">
            Save a key to load available models.
          </Text>
        )}
        {keySaved && modelsLoading && (
          <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
            <ActivityIndicator size="small" color={c.muted} />
            <Text className="text-muted text-xs">Loading models…</Text>
          </View>
        )}
        {keySaved && !modelsLoading && modelsError === 'invalid' && (
          <Text className="text-negative text-xs mb-2">
            That key was rejected — save a valid key to load models.
          </Text>
        )}
        {keySaved && !modelsLoading && modelsError === 'network' && (
          <Text className="text-negative text-xs mb-2">
            Couldn't load models — offline or the provider is unreachable.
          </Text>
        )}
        {keySaved && !modelsLoading && !modelsError && models?.length === 0 && (
          <Text className="text-muted text-xs mb-2">
            No models found — enter one manually.
          </Text>
        )}
        {keySaved && !modelsLoading && (
          <Pressable
            onPress={() => void loadModels(provider)}
            className="self-start mb-2"
            accessibilityRole="button"
            accessibilityLabel="Reload models"
          >
            <Text className="text-primary text-xs font-semibold">
              {modelsError ? 'Retry' : 'Reload models'}
            </Text>
          </Pressable>
        )}

        {showCustomField ? (
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
        ) : (
          <Pressable
            onPress={() => setPickerVisible(true)}
            className="bg-surfaceAlt border border-border rounded-md px-3 py-2.5 flex-row items-center justify-between"
            accessibilityRole="button"
            accessibilityLabel="Choose model"
          >
            <Text className="text-text text-[13px] flex-1" numberOfLines={1}>
              {selectedLabel}
            </Text>
            <Feather name="chevron-down" size={16} color={c.muted} />
          </Pressable>
        )}
      </View>

      <ModelPickerSheet
        visible={pickerVisible}
        title="Choose model"
        models={models ?? []}
        selectedId={model}
        onSelectModel={(choice) => void onSelectModel(choice)}
        onSelectCustom={onSelectCustom}
        onClose={() => setPickerVisible(false)}
      />

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
              : testResult === 'not_found'
                ? 'Model not found — check the model id.'
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
