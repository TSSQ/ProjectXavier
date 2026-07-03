import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RecurrenceFrequency, RecurrenceRule } from '../../domain/types';
import { startOfUTCDay } from '../../domain/recurrence';
import { DateField } from './DateField';
import { colors } from '../../theme/tokens';

const PRESETS = [
  { label: 'Never', value: 'never' as const },
  { label: 'Daily', value: 'daily' as const },
  { label: 'Weekly', value: 'weekly' as const },
  { label: 'Every 2 weeks', value: 'biweekly' as const },
  { label: 'Monthly', value: 'monthly' as const },
  { label: 'Quarterly', value: 'quarterly' as const },
  { label: 'Semi-annually', value: 'semiannually' as const },
  { label: 'Annual', value: 'annual' as const },
  { label: 'Custom', value: 'custom' as const },
] as const;

type Preset = (typeof PRESETS)[number]['value'];

function presetToRule(preset: Preset, anchor: number): RecurrenceRule | null {
  const base = { anchor: startOfUTCDay(anchor), end: { kind: 'never' as const } };
  switch (preset) {
    case 'never': return null;
    case 'daily': return { ...base, freq: 'daily' as const, interval: 1 };
    case 'weekly': return { ...base, freq: 'weekly' as const, interval: 1 };
    case 'biweekly': return { ...base, freq: 'weekly' as const, interval: 2 };
    case 'monthly': return { ...base, freq: 'monthly' as const, interval: 1 };
    case 'quarterly': return { ...base, freq: 'monthly' as const, interval: 3 };
    case 'semiannually': return { ...base, freq: 'monthly' as const, interval: 6 };
    case 'annual': return { ...base, freq: 'yearly' as const, interval: 1 };
    case 'custom': return null;
  }
}

function ruleToPreset(rule: RecurrenceRule | null): Preset {
  if (!rule) return 'never';
  const { freq, interval } = rule;
  if (freq === 'daily' && interval === 1) return 'daily';
  if (freq === 'weekly' && interval === 1) return 'weekly';
  if (freq === 'weekly' && interval === 2) return 'biweekly';
  if (freq === 'monthly' && interval === 1) return 'monthly';
  if (freq === 'monthly' && interval === 3) return 'quarterly';
  if (freq === 'monthly' && interval === 6) return 'semiannually';
  if (freq === 'yearly' && interval === 1) return 'annual';
  return 'custom';
}

const FREQS: { key: RecurrenceFrequency; label: string }[] = [
  { key: 'daily', label: 'Day' },
  { key: 'weekly', label: 'Week' },
  { key: 'monthly', label: 'Month' },
  { key: 'yearly', label: 'Year' },
];

function unitLabel(freq: RecurrenceFrequency, n: number): string {
  const map: Record<RecurrenceFrequency, [string, string]> = {
    daily: ['day', 'days'],
    weekly: ['week', 'weeks'],
    monthly: ['month', 'months'],
    yearly: ['year', 'years'],
  };
  return map[freq][n === 1 ? 0 : 1];
}

/**
 * Bottom-sheet for picking a recurrence rule. Preset options dismiss the sheet
 * immediately; "Custom" reveals an inline editor with a Done button.
 * Styled to match the standardized sheet design system.
 */
export function RepeatSheet({
  visible,
  anchor,
  initialRule,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** The transaction date used as the recurrence anchor (epoch ms). */
  anchor: number;
  initialRule: RecurrenceRule | null;
  onSelect: (rule: RecurrenceRule | null) => void;
  onClose: () => void;
}) {
  const initPreset = ruleToPreset(initialRule);

  const [preset, setPreset] = useState<Preset>(initPreset);
  const [freq, setFreq] = useState<RecurrenceFrequency>(initialRule?.freq ?? 'monthly');
  const [interval, setInterval] = useState(String(initialRule?.interval ?? 1));
  const [endKind, setEndKind] = useState<'never' | 'until' | 'count'>(
    initialRule?.end.kind ?? 'never',
  );
  const [endDate, setEndDate] = useState(Date.now() + 365 * 86_400_000);
  const [endCount, setEndCount] = useState(12);

  const handlePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      onSelect(presetToRule(p, anchor));
      onClose();
    }
  };

  const intervalNum = Math.max(1, Math.min(365, Number(interval) || 1));

  const decInterval = () => setInterval(String(Math.max(1, intervalNum - 1)));
  const incInterval = () => setInterval(String(Math.min(365, intervalNum + 1)));

  const handleDone = () => {
    let end: RecurrenceRule['end'];
    if (endKind === 'until') end = { kind: 'until', date: startOfUTCDay(endDate) };
    else if (endKind === 'count') end = { kind: 'count', n: Math.max(1, endCount) };
    else end = { kind: 'never' };

    onSelect({
      freq,
      interval: intervalNum,
      anchor: startOfUTCDay(anchor),
      end,
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl pt-3 pb-8"
          style={{ maxHeight: '90%' }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Grab handle */}
          <View className="w-9 h-1.5 rounded-full self-center mb-3" style={{ backgroundColor: colors.grabHandle }} />

          {/* Header */}
          <View className="flex-row items-center justify-between px-4 mb-4">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
              accessibilityLabel="Close repeat picker"
            >
              <Feather name="x" size={16} color={colors.textMuted} />
            </Pressable>
            <Text className="text-text text-base font-extrabold">Repeat</Text>
            <View className="w-8 h-8" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 4 }}>
            {/* Preset list */}
            <View className="bg-surface border border-border rounded-md overflow-hidden mb-4">
              {PRESETS.map((p, i) => {
                const selected = preset === p.value;
                return (
                  <View key={p.value}>
                    {i > 0 && (
                      <View
                        className="border-t border-border"
                        style={{ marginLeft: 16, marginRight: 16 }}
                      />
                    )}
                    <Pressable
                      onPress={() => handlePreset(p.value)}
                      className="flex-row items-center justify-between px-4 py-3.5"
                      style={{ gap: 12 }}
                    >
                      <Text
                        className={`text-base flex-1 ${selected ? 'text-primary font-semibold' : 'text-text'}`}
                      >
                        {p.label}
                      </Text>
                      {selected && (
                        <Feather name="check" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Custom editor */}
            {preset === 'custom' && (
              <>
                <Text className="text-muted text-xs font-semibold mb-2">Frequency</Text>
                <View className="flex-row bg-surfaceAlt border border-border rounded-md p-1 mb-3">
                  {FREQS.map((f) => {
                    const active = freq === f.key;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => setFreq(f.key)}
                        className={`flex-1 py-2 rounded-sm items-center ${active ? 'bg-surface' : ''}`}
                      >
                        <Text
                          className={`text-xs font-semibold ${active ? 'text-primary' : 'text-muted'}`}
                        >
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text className="text-muted text-xs font-semibold mb-2">Every</Text>
                <View
                  className="flex-row items-center bg-surface border border-border rounded-md px-4 py-3 mb-4"
                  style={{ gap: 12 }}
                >
                  <Pressable
                    onPress={decInterval}
                    className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
                  >
                    <Feather name="minus" size={14} color={colors.textMuted} />
                  </Pressable>
                  <Text className="flex-1 text-center text-text text-lg font-bold">
                    {intervalNum} {unitLabel(freq, intervalNum)}
                  </Text>
                  <Pressable
                    onPress={incInterval}
                    className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
                  >
                    <Feather name="plus" size={14} color={colors.textMuted} />
                  </Pressable>
                </View>

                <Text className="text-muted text-xs font-semibold mb-2">End repeat</Text>
                <View className="bg-surface border border-border rounded-md overflow-hidden mb-5">
                  {/* Never */}
                  <Pressable
                    onPress={() => setEndKind('never')}
                    className="flex-row items-center justify-between px-4 py-3.5"
                    style={{ gap: 12 }}
                  >
                    <Text
                      className={`text-base flex-1 ${endKind === 'never' ? 'text-primary font-semibold' : 'text-text'}`}
                    >
                      Never
                    </Text>
                    {endKind === 'never' && <Feather name="check" size={16} color={colors.primary} />}
                  </Pressable>

                  <View className="border-t border-border" style={{ marginLeft: 16, marginRight: 16 }} />

                  {/* On date */}
                  <Pressable
                    onPress={() => setEndKind('until')}
                  >
                    <View className="flex-row items-center justify-between px-4 py-3.5" style={{ gap: 12 }}>
                      <Text
                        className={`text-base flex-1 ${endKind === 'until' ? 'text-primary font-semibold' : 'text-text'}`}
                      >
                        On date
                      </Text>
                      {endKind === 'until' && <Feather name="check" size={16} color={colors.primary} />}
                    </View>
                    {endKind === 'until' && (
                      <View className="px-4 pb-3">
                        <DateField
                          value={endDate}
                          onChange={setEndDate}
                          accessibilityLabel="End repeat date"
                        />
                      </View>
                    )}
                  </Pressable>

                  <View className="border-t border-border" style={{ marginLeft: 16, marginRight: 16 }} />

                  {/* After N occurrences */}
                  <Pressable onPress={() => setEndKind('count')}>
                    <View className="flex-row items-center justify-between px-4 py-3.5" style={{ gap: 12 }}>
                      <Text
                        className={`text-base flex-1 ${endKind === 'count' ? 'text-primary font-semibold' : 'text-text'}`}
                      >
                        After N occurrences
                      </Text>
                      {endKind === 'count' && <Feather name="check" size={16} color={colors.primary} />}
                    </View>
                    {endKind === 'count' && (
                      <View
                        className="flex-row items-center px-4 pb-3"
                        style={{ gap: 12 }}
                      >
                        <Pressable
                          onPress={() => setEndCount(Math.max(1, endCount - 1))}
                          className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
                        >
                          <Feather name="minus" size={14} color={colors.textMuted} />
                        </Pressable>
                        <Text className="flex-1 text-center text-text text-base font-bold">
                          {endCount} {endCount === 1 ? 'time' : 'times'}
                        </Text>
                        <Pressable
                          onPress={() => setEndCount(Math.min(9999, endCount + 1))}
                          className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
                        >
                          <Feather name="plus" size={14} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                </View>

                <Pressable
                  onPress={handleDone}
                  className="bg-primary rounded-pill py-3.5 items-center mb-2"
                >
                  <Text className="text-white font-bold text-base">Done</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
