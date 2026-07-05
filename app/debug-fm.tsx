/**
 * On-device AI (Apple Foundation Models) debug screen — test builds only.
 *
 * Lets a developer eyeball the on-device parse tier (src/features/ai/deviceParse.ts)
 * directly on a device: the raw Foundation Models availability state, the
 * app's own isDeviceAiAvailable() gate, and a repeatable "run one parse" probe
 * against real on-device grounding data (categories/payees). Reached from a
 * hidden Settings → Developer row that only appears when METRICS_ENABLED, same
 * as debug-metrics.tsx.
 *
 * Note: react-native-apple-llm's session throws "exceeded context window" on
 * the very first call per process and tends to succeed on later calls — the
 * run counter and per-run result list make that visible instead of hiding it.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isFoundationModelsEnabled } from 'react-native-apple-llm';
import { isDeviceAiAvailable, deviceParse } from '../src/features/ai/deviceParse';
import { listCategories } from '../src/features/categories/repository';
import { listPayees } from '../src/features/payees/repository';
import { AiParsedExpense } from '../src/lib/validation';
import { useThemeColors } from '../src/theme/useThemeColors';

const DEFAULT_TEXT = 'spent 20 at Starbucks on coffee';

interface RunResult {
  n: number;
  elapsedMs: number;
  fm: AiParsedExpense | null;
  error: string | null;
}

export default function DebugFmScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rawState, setRawState] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);

  const loadAvailability = useCallback(async () => {
    try {
      const state = await isFoundationModelsEnabled();
      setRawState(String(state));
    } catch (e) {
      setRawState(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setAvailable(await isDeviceAiAvailable());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAvailability();
    }, [loadAvailability])
  );

  const onRun = async () => {
    setBusy(true);
    const startedAt = Date.now();
    let fm: AiParsedExpense | null = null;
    let error: string | null = null;
    try {
      const [categories, payees] = await Promise.all([listCategories(), listPayees()]);
      fm = await deviceParse(text, { categories, payees, now: Date.now() });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const elapsedMs = Date.now() - startedAt;
    setRuns((prev) => [{ n: prev.length + 1, elapsedMs, fm, error }, ...prev]);
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

        <Text className="text-text text-[24px] font-extrabold mb-1">On-device AI</Text>
        <Text className="text-muted text-xs mb-4">
          Test-build diagnostics · Apple Foundation Models on-device parse tier.
        </Text>

        <Section title="Availability" />
        <Stat label="isFoundationModelsEnabled()" value={rawState ?? 'loading…'} />
        <Stat label="isDeviceAiAvailable()" value={available == null ? 'loading…' : String(available)} />

        <Section title="Run a parse" />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={DEFAULT_TEXT}
          placeholderTextColor={c.muted}
          className="bg-surfaceAlt border border-border rounded-md px-3 py-2 text-text text-[13px] mb-3"
          multiline
        />
        <Pressable
          onPress={onRun}
          disabled={busy}
          className="bg-primary rounded-md px-4 py-3 items-center mb-2"
          style={{ opacity: busy ? 0.6 : 1 }}
          accessibilityLabel="Run on-device parse"
        >
          <Text className="text-white text-[14px] font-bold">
            {busy ? 'Running…' : 'Run on-device parse'}
          </Text>
        </Pressable>

        {runs.length === 0 ? (
          <Text className="text-muted mt-4">No runs yet.</Text>
        ) : (
          <>
            <Section title="Results (most recent first)" />
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
      ) : r.fm == null ? (
        <Text className="text-muted text-[12px]">null (FM declined/failed)</Text>
      ) : (
        <>
          <Field label="amount" value={String(r.fm.amount)} />
          <Field label="currency" value={String(r.fm.currency)} />
          <Field label="type" value={String(r.fm.type)} />
          <Field label="category" value={String(r.fm.category)} />
          <Field label="payee" value={String(r.fm.payee)} />
          <Field label="account" value={String(r.fm.account)} />
          <Field label="note" value={String(r.fm.note)} />
          <Field
            label="occurredAt"
            value={r.fm.occurredAt == null ? 'null' : new Date(r.fm.occurredAt).toISOString()}
          />
          <Field label="confidence" value={String(r.fm.confidence)} />
        </>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-0.5">
      <Text className="text-muted text-[12px]">{label}</Text>
      <Text className="text-text text-[12px] font-semibold">{value}</Text>
    </View>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mt-5 mb-2">
      {title}
    </Text>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between bg-surface border border-border rounded-md px-3.5 py-3 mb-2">
      <Text className="text-text text-[13px] font-semibold flex-1 pr-3">{label}</Text>
      <Text className="text-text text-[13px] font-extrabold">{value}</Text>
    </View>
  );
}
