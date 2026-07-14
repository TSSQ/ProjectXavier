/**
 * On-device OCR debug screen — test builds only.
 *
 * The camera can't run on the simulator, so this screen drives the same
 * recognizer (src/features/ocr/appleVisionRecognizer.ts) from a photo-library
 * pick instead: drag a receipt photo onto the simulator to seed its library,
 * then pick it here. Shows elapsed ms, character count, and the raw
 * recognized text so a developer can eyeball OCR quality without a device.
 * Reached from a hidden Settings → Developer row that only appears when
 * METRICS_ENABLED, same as debug-fm.tsx.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { getRecognizer } from '../src/features/ocr/appleVisionRecognizer';
import { useThemeColors } from '../src/theme/useThemeColors';
import { METRICS_ENABLED } from '../src/lib/flags';

interface RunResult {
  n: number;
  elapsedMs: number;
  text: string | null;
  error: string | null;
}

export default function DebugOcrScreen() {
  // Deep links (projectxavier://debug-ocr) must be inert in production.
  if (!METRICS_ENABLED) return <Redirect href="/" />;

  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const onPick = async () => {
    if (busy) return;
    setPermissionError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPermissionError('Photo library access denied — enable it in Settings to pick a photo.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;

    setBusy(true);
    const startedAt = Date.now();
    let text: string | null = null;
    let error: string | null = null;
    try {
      text = await getRecognizer().recognize(picked.assets[0].uri);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const elapsedMs = Date.now() - startedAt;
    setRuns((prev) => [{ n: prev.length + 1, elapsedMs, text, error }, ...prev]);
    setBusy(false);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back" className="flex-row items-center">
            <Feather name="chevron-left" size={24} color={c.muted} />
            <Text className="text-muted text-base ml-1">Back</Text>
          </Pressable>
        </View>

        <Text className="text-text text-[24px] font-extrabold mb-1">On-device OCR</Text>
        <Text className="text-muted text-xs mb-4">
          Test-build diagnostics · Apple Vision receipt text recognition.
        </Text>

        <Pressable
          onPress={onPick}
          disabled={busy}
          className="bg-primary rounded-md px-4 py-3 items-center mb-2"
          style={{ opacity: busy ? 0.6 : 1 }}
          accessibilityLabel="Pick a photo to recognize"
        >
          <Text className="text-white text-[14px] font-bold">
            {busy ? 'Recognizing…' : 'Pick a photo from library'}
          </Text>
        </Pressable>

        {permissionError ? (
          <Text className="text-negative text-[12px] mb-2">{permissionError}</Text>
        ) : null}

        {runs.length === 0 ? (
          <Text className="text-muted mt-4">No runs yet.</Text>
        ) : (
          <>
            <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mt-5 mb-2">
              Results (most recent first)
            </Text>
            {runs.map((r) => (
              <RunCard key={r.n} r={r} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function RunCard({ r }: { r: RunResult }) {
  return (
    <View className="bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text text-[13px] font-extrabold">Run #{r.n}</Text>
        <Text className="text-muted text-[11px]">{r.elapsedMs} ms</Text>
      </View>
      {r.error ? (
        <Text className="text-negative text-[12px]">Threw: {r.error}</Text>
      ) : (
        <>
          <Text className="text-muted text-[12px] mb-2">{r.text?.length ?? 0} characters</Text>
          <ScrollView className="bg-surfaceAlt border border-border rounded-md p-2.5" style={{ maxHeight: 220 }}>
            <Text className="text-text text-[11px] font-mono">{r.text || '(empty)'}</Text>
          </ScrollView>
        </>
      )}
    </View>
  );
}
