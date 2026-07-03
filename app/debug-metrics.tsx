/**
 * Parse-diagnostics debug screen (test builds only).
 *
 * Shows the headline numbers that decide whether the local parsing layers need
 * the cloud LLM, plus a raw JSON export via the Share sheet. Reached from a
 * hidden Settings row that only appears when METRICS_ENABLED. Production never
 * links here and the table is empty there anyway. See parse-metrics-spec.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listMetrics,
  aggregate,
  MetricsAggregate,
  MetricRow,
} from '../src/features/diagnostics/parseMetrics';
import { colors } from '../src/theme/tokens';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function DebugMetricsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [agg, setAgg] = useState<MetricsAggregate | null>(null);

  const load = useCallback(async () => {
    const data = await listMetrics();
    setRows(data);
    setAgg(aggregate(data));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onExport = async () => {
    if (rows.length === 0) return Alert.alert('No metrics yet');
    try {
      await Share.share({ message: JSON.stringify(rows, null, 2) });
    } catch {
      Alert.alert('Export failed');
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back" className="flex-row items-center">
            <Feather name="chevron-left" size={24} color={colors.textMuted} />
            <Text className="text-muted text-base ml-1">Back</Text>
          </Pressable>
          <Pressable
            onPress={onExport}
            className="flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2"
            style={{ gap: 6 }}
            accessibilityLabel="Export metrics"
          >
            <Feather name="share" size={14} color={colors.textMuted} />
            <Text className="text-text text-[13px] font-bold">Export JSON</Text>
          </Pressable>
        </View>

        <Text className="text-text text-[24px] font-extrabold mb-1">Parse metrics</Text>
        <Text className="text-muted text-xs mb-4">
          Test-build diagnostics · content-free · decides if the cloud layer (L2) is needed.
        </Text>

        {!agg || agg.total === 0 ? (
          <Text className="text-muted mt-4">
            No parses recorded yet. Log an expense via the assistant to populate this.
          </Text>
        ) : (
          <>
            <Stat label="Total parses" value={String(agg.total)} />

            <Section title="Decision signals" />
            <Stat
              label="Material-edit rate (saved AI)"
              value={pct(agg.materialEditRate)}
              hint="Key L2 signal — saved entries the user later corrected"
              emphasize
            />
            <Stat label="Clarify rate" value={pct(agg.clarifyRate)} hint="Parses too uncertain to draft" />
            <Stat
              label="Saved / discarded"
              value={`${agg.saved} / ${agg.discarded}`}
            />
            <Stat label="Edited before save" value={String(agg.editedAtDraft)} />
            <Stat label="Payee suggestion taken" value={String(agg.payeeSwapped)} />

            <Section title="Outcomes" />
            {Object.entries(agg.byOutcome).map(([k, v]) => (
              <Stat key={k} label={k} value={String(v)} />
            ))}

            <Section title="Post-save edits by field" />
            <Stat label="Any field" value={String(agg.edited)} />
            <Stat label="Amount" value={String(agg.editedByField.amount)} />
            <Stat label="Type" value={String(agg.editedByField.type)} />
            <Stat label="Payee" value={String(agg.editedByField.payee)} />
            <Stat label="Category" value={String(agg.editedByField.category)} />
            <Stat label="Date" value={String(agg.editedByField.date)} />

            <Section title="Confidence distribution (0–4)" />
            <View className="flex-row" style={{ gap: 6 }}>
              {agg.confidenceHistogram.map((n, i) => (
                <View key={i} className="flex-1 bg-surface border border-border rounded-md items-center py-2">
                  <Text className="text-text text-sm font-extrabold">{n}</Text>
                  <Text className="text-muted text-[10px] mt-0.5">b{i}</Text>
                </View>
              ))}
            </View>

            <Section title="Performance / engine" />
            <Stat
              label="Median latency"
              value={agg.medianLatencyMs == null ? '—' : `${agg.medianLatencyMs} ms`}
            />
            {Object.entries(agg.byEngine).map(([k, v]) => (
              <Stat key={k} label={`engine: ${k}`} value={String(v)} />
            ))}
          </>
        )}
      </ScrollView>
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

function Stat({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between bg-surface border rounded-md px-3.5 py-3 mb-2 ${
        emphasize ? 'border-primary' : 'border-border'
      }`}
    >
      <View className="flex-1 pr-3">
        <Text className="text-text text-[13px] font-semibold">{label}</Text>
        {hint ? <Text className="text-muted text-[10px] mt-0.5">{hint}</Text> : null}
      </View>
      <Text className={`text-[15px] font-extrabold ${emphasize ? 'text-primary' : 'text-text'}`}>
        {value}
      </Text>
    </View>
  );
}
