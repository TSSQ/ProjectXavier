/**
 * On-device AI (Apple Foundation Models) debug screen — test builds only.
 *
 * Lets a developer eyeball the on-device parse tier (src/features/ai/deviceParse.ts)
 * directly on a device: the binding's raw availability, the app's own
 * isDeviceAiAvailable() gate, and a repeatable "run one parse" probe
 * against real on-device grounding data (categories/payees). Reached from a
 * hidden Settings → Developer row that only appears when METRICS_ENABLED, same
 * as debug-metrics.tsx.
 *
 * Runs go through deviceParseUnsafe (not the null-swallowing deviceParse) so
 * a binding/generation failure shows its real error message here; the run
 * counter and per-run result list keep first-call-vs-warmed behaviour visible.
 *
 * Supports unattended probing via deep link — the screen is directly
 * routable and runs one parse on mount when asked, so a test harness can
 * drive it without UI taps:
 *   projectxavier://debug-fm?autorun=1[&text=lunch%2012.50%20at%20Subway]
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apple } from '@react-native-ai/apple';
import { isDeviceAiAvailable, deviceParseUnsafe } from '../src/features/ai/deviceParse';
import { formatMoney } from '../src/domain/money';
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
  const params = useLocalSearchParams<{ autorun?: string; text?: string }>();

  const initialText =
    typeof params.text === 'string' && params.text.trim().length
      ? params.text
      : DEFAULT_TEXT;
  const [rawState, setRawState] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);

  const loadAvailability = useCallback(async () => {
    try {
      setRawState(String(apple.isAvailable()));
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

  const runParse = useCallback(async (parseText: string) => {
    setBusy(true);
    const startedAt = Date.now();
    let fm: AiParsedExpense | null = null;
    let error: string | null = null;
    try {
      const [categories, payees] = await Promise.all([listCategories(), listPayees()]);
      fm = await deviceParseUnsafe(parseText, { categories, payees, now: Date.now() });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const elapsedMs = Date.now() - startedAt;
    setRuns((prev) => [{ n: prev.length + 1, elapsedMs, fm, error }, ...prev]);
    setBusy(false);
  }, []);

  const onRun = () => runParse(text);

  const autoran = useRef(false);
  useEffect(() => {
    if (params.autorun === '1' && !autoran.current) {
      autoran.current = true;
      runParse(initialText);
    }
  }, [params.autorun, initialText, runParse]);

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
        <Stat label="apple.isAvailable()" value={rawState ?? 'loading…'} />
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
        <Text className="text-muted text-[12px]">null (output failed schema validation)</Text>
      ) : (
        <>
          <Field
            label="amount"
            value={
              r.fm.amount == null
                ? 'null'
                : `${formatMoney(r.fm.amount, r.fm.currency ?? 'USD')} (${r.fm.amount} minor)`
            }
          />
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
