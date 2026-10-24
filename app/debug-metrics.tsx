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
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sideGutters } from '../src/domain/screenGutters';
import {
  listMetrics,
  aggregate,
  aggregateByEngine,
  MetricsAggregate,
  EngineStats,
  MetricRow,
} from '../src/features/diagnostics/parseMetrics';
import { readCorrectionCases } from '../src/features/diagnostics/corrections';
import {
  aggregateCorrectionEdits,
  CORRECTION_FIELDS,
  EngineEditStats,
} from '../src/domain/correctionEdits';
import { useThemeColors } from '../src/theme/useThemeColors';
import { METRICS_ENABLED } from '../src/lib/flags';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function DebugMetricsScreen() {
  // Deep links (projectxavier://debug-metrics) must be inert in production.
  if (!METRICS_ENABLED) return <Redirect href="/" />;

  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [agg, setAgg] = useState<MetricsAggregate | null>(null);
  const [byEngine, setByEngine] = useState<Record<string, EngineStats>>({});
  // What users changed, per engine — from the on-device corrections file
  // (parse-correction-loop-spec.md §6), not from parse_metrics.
  const [editsByEngine, setEditsByEngine] = useState<Record<string, EngineEditStats>>({});

  const load = useCallback(async () => {
    const data = await listMetrics();
    setRows(data);
    setAgg(aggregate(data));
    setByEngine(aggregateByEngine(data));
    setEditsByEngine(aggregateCorrectionEdits(await readCorrectionCases()));
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
      <ScrollView contentContainerStyle={{ padding: 24, ...sideGutters(insets, 24), paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back" className="flex-row items-center">
            <Feather name="chevron-left" size={24} color={c.muted} />
            <Text className="text-muted text-base ml-1">Back</Text>
          </Pressable>
          <Pressable
            onPress={onExport}
            className="flex-row items-center bg-controlRaised border border-border rounded-pill px-3.5 py-2"
            style={{ gap: 6, ...c.elevation.raised }}
            accessibilityLabel="Export metrics"
          >
            <Feather name="share" size={14} color={c.muted} />
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
            <Stat
              label="FM refusals: logged anyway / accepted"
              value={`${agg.refusedOverridden} / ${agg.refusedDismissed}`}
              hint="Logged anyway = a false refusal"
            />
            <Stat
              label="FM fallbacks: threw / invalid / unavailable"
              value={`${agg.fmFallbacks.threw ?? 0} / ${agg.fmFallbacks.invalid ?? 0} / ${agg.fmFallbacks.unavailable ?? 0}`}
              hint="Why the on-device tier handed over to the basic parser"
            />
            <Stat
              label="Cue refusals: logged anyway / accepted"
              value={`${agg.notTransactionCues.overridden} / ${agg.notTransactionCues.discarded}`}
              hint="Refused by the not-a-transaction cue check before the model ran"
            />
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

            <Section title="By engine" />
            <Text className="text-muted text-[10px] mb-2">
              Save rate = saved ÷ transaction confirm cards. Edit rates = share of SAVED rows the
              user later corrected, overall and per field. Refusals: total / logged anyway (a false
              refusal). Account, delete-handoff, tx_op and query cards are counted on their own line,
              never in the rates. "What users changed" reads the on-device corrections file:
              per field, how many captured cases changed it and the top 5 changes (amount by kind of
              change, date by day offset).
            </Text>
            {Object.entries(byEngine).map(([engine, s]) => (
              <View key={engine} className="bg-surface border border-border rounded-md px-3.5 py-3 mb-2">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-text text-[13px] font-bold">{engine}</Text>
                  <Text className="text-muted text-[11px]">{s.parses} parses</Text>
                </View>
                <EngineLine label="Save rate" value={`${pct(s.saveRate)} (${s.saved}/${s.confirms})`} />
                <EngineLine label="Edit rate (any field)" value={`${pct(s.editRate)} (${s.edited}/${s.saved})`} />
                <EngineLine
                  label="Edited: amount / type / payee / category / date"
                  value={[
                    s.editRateByField.amount,
                    s.editRateByField.type,
                    s.editRateByField.payee,
                    s.editRateByField.category,
                    s.editRateByField.date,
                  ]
                    .map(pct)
                    .join(' / ')}
                />
                <EngineLine label="Refused / logged anyway" value={`${s.refused} / ${s.refusedOverridden}`} />
                <EngineLine
                  label="Phrase memory applied / kept"
                  value={`${s.memoryApplied} / ${s.memoryKept} (${pct(s.memoryKeepRate)})`}
                />
                {s.questions.count > 0 ? (
                  <>
                    <EngineLine
                      label="Questions answered / marked wrong"
                      value={`${s.questions.count} / ${s.questions.wrong} (${pct(s.questions.wrongRate)})`}
                    />
                    <EngineLine
                      label="Wrong: tool / period / filter"
                      value={`${s.questions.byDimension.tool} / ${s.questions.byDimension.period} / ${s.questions.byDimension.filter}`}
                    />
                  </>
                ) : null}
                {Object.keys(s.otherIntents).length > 0 ? (
                  <EngineLine
                    label="Other cards"
                    value={Object.entries(s.otherIntents)
                      .map(([intent, n]) => `${intent} ${n}`)
                      .join(' · ')}
                  />
                ) : null}
                {editsByEngine[engine] ? <EngineEdits stats={editsByEngine[engine]} /> : null}
              </View>
            ))}
            {Object.entries(editsByEngine)
              .filter(([engine]) => !byEngine[engine])
              .map(([engine, stats]) => (
                <View key={engine} className="bg-surface border border-border rounded-md px-3.5 py-3 mb-2">
                  <Text className="text-text text-[13px] font-bold mb-1">{engine}</Text>
                  <EngineEdits stats={stats} />
                </View>
              ))}

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

function EngineEdits({ stats }: { stats: EngineEditStats }) {
  const changed = CORRECTION_FIELDS.filter((f) => stats.fields[f].edits > 0);
  return (
    <View className="mt-2 pt-2 border-t border-border">
      <EngineLine
        label="What users changed (cases / discarded / after a refusal)"
        value={`${stats.cases} / ${stats.discarded} / ${stats.refused}`}
      />
      {changed.map((f) => (
        <View key={f} className="py-0.5">
          <Text className="text-muted text-[11px]">
            {f} · {stats.fields[f].edits} edit{stats.fields[f].edits === 1 ? '' : 's'}
          </Text>
          <Text className="text-text text-[12px] font-semibold">
            {stats.fields[f].top.map((t) => `${t.pair} ×${t.count}`).join(' · ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EngineLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text className="text-muted text-[11px] flex-1 pr-2">{label}</Text>
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
