import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Transaction } from '../../domain/types';
import {
  Granularity,
  activePeriods,
  startOfPeriod,
  endOfPeriod,
} from '../../domain/period';
import { formatMoney } from '../../domain/money';
import { useThemeColors } from '../../theme/useThemeColors';

export type PeriodMode = 'month' | 'year' | 'date';

export interface PeriodSelection {
  mode: PeriodMode;
  /** Inclusive start, epoch ms. */
  start: number;
  /** Exclusive end, epoch ms. */
  end: number;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function monthLabel(start: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(start));
}

export function periodLabel(sel: { mode: PeriodMode; start: number }): string {
  if (sel.mode === 'year') return String(new Date(sel.start).getFullYear());
  if (sel.mode === 'date') return shortDate(sel.start);
  return monthLabel(sel.start);
}

export function currentMonthSelection(now = Date.now()): PeriodSelection {
  const start = startOfPeriod(now, 'month');
  const end = endOfPeriod(start, 'month');
  return { mode: 'month', start, end, label: monthLabel(start) };
}

/** Bottom-sheet period picker: Month / Year / Date tabs. */
export function PeriodSheet({
  visible,
  initialMode,
  transactions,
  currency,
  onSelect,
  onClose,
}: {
  visible: boolean;
  initialMode: PeriodMode;
  transactions: Transaction[];
  currency: string;
  onSelect: (sel: PeriodSelection) => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const [tab, setTab] = useState<PeriodMode>(initialMode);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const now = Date.now();
  const rows = useMemo(
    () => (tab === 'date' ? [] : buildRows(transactions, tab, now)),
    [transactions, tab, now]
  );

  const choose = (start: number, end: number, gran: Granularity) =>
    onSelect({
      mode: gran === 'year' ? 'year' : 'month',
      start,
      end,
      label: gran === 'year' ? String(new Date(start).getFullYear()) : monthLabel(start),
    });

  const applyDate = () => {
    const start = parseYmd(from);
    const end = parseYmd(to);
    if (start === null || end === null) {
      setDateError('Use dates like 2026-01-31.');
      return;
    }
    if (end < start) {
      setDateError('End must be on or after start.');
      return;
    }
    setDateError(null);
    onSelect({
      mode: 'date',
      start,
      end: end + DAY_MS, // make the end date inclusive
      label: `${shortDate(start)} – ${shortDate(end)}`,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-2xl px-4 pt-3 pb-7"
          style={{ maxHeight: '82%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-full bg-grabHandle self-center mb-3" />
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
              accessibilityLabel="Close period picker"
            >
              <Feather name="x" size={16} color={c.muted} />
            </Pressable>
            <Text className="text-text text-base font-extrabold">Period</Text>
            <View className="w-8 h-8" />
          </View>

          <View className="flex-row bg-bg rounded-pill p-1 mb-3.5">
            {(['month', 'year', 'date'] as PeriodMode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setTab(m)}
                className={`flex-1 py-2 rounded-pill items-center ${tab === m ? 'bg-surfaceAlt' : ''}`}
              >
                <Text
                  className={`text-[13px] font-bold capitalize ${tab === m ? 'text-accent' : 'text-muted'}`}
                >
                  {m}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'date' ? (
            <View className="bg-white/5 rounded-2xl p-1">
              <DateRow label="From" value={from} onChange={setFrom} />
              <DateRow label="To" value={to} onChange={setTo} />
              {dateError && (
                <Text className="text-negative text-xs px-2.5 pb-1">{dateError}</Text>
              )}
              <Pressable onPress={applyDate} className="px-2.5 py-3.5">
                <Text className="text-accent text-base font-bold">Apply</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView className="bg-white/5 rounded-2xl px-1" style={{ maxHeight: 420 }}>
              {rows.length === 0 ? (
                <Text className="text-muted text-center py-6">No transactions yet.</Text>
              ) : (
                rows.map((r, i) => (
                  <Pressable
                    key={r.start}
                    onPress={() => choose(r.start, r.end, tab as Granularity)}
                    className={`flex-row items-center justify-between px-2.5 py-3 ${i < rows.length - 1 ? 'border-b border-white/5' : ''}`}
                  >
                    <View>
                      <Text className={`text-[15px] font-semibold ${r.isCurrent ? 'text-accent' : 'text-text'}`}>
                        {r.label}
                      </Text>
                      <Text className="text-muted text-xs mt-0.5">
                        {r.count} {r.count === 1 ? 'transaction' : 'transactions'}
                      </Text>
                    </View>
                    <Text
                      className={`text-[13px] font-bold px-2.5 py-1.5 rounded-md ${
                        r.net < 0
                          ? 'text-amountNegFg bg-amountNegBg'
                          : 'text-amountPosFg bg-amountPosBg'
                      }`}
                    >
                      {signed(r.net, currency)}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface PeriodRow {
  start: number;
  end: number;
  label: string;
  count: number;
  net: number;
  isCurrent: boolean;
}

function buildRows(
  transactions: Transaction[],
  gran: Exclude<PeriodMode, 'date'>,
  now: number
): PeriodRow[] {
  const periods = activePeriods(transactions, gran); // newest first
  const curStart = startOfPeriod(now, gran);
  if (!periods.some((p) => p.start === curStart)) {
    periods.unshift({
      start: curStart,
      end: endOfPeriod(curStart, gran),
      totals: { income: 0, expense: 0, net: 0 },
    });
  }
  const counts = new Map<number, number>();
  for (const tx of transactions) {
    const s = startOfPeriod(tx.occurredAt, gran);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return periods.map((p) => {
    const isCurrent = p.start === curStart;
    const label = isCurrent
      ? gran === 'year'
        ? 'Current Year'
        : 'Current Month'
      : gran === 'year'
        ? String(new Date(p.start).getFullYear())
        : monthLabel(p.start);
    return {
      start: p.start,
      end: p.end,
      label,
      count: counts.get(p.start) ?? 0,
      net: p.totals.net,
      isCurrent,
    };
  });
}

function DateRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const c = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-2.5 py-2.5 border-b border-white/5">
      <Text className="text-text text-[15px]">{label}</Text>
      <TextInput
        className="text-text text-[15px] font-bold text-right"
        placeholder="YYYY-MM-DD"
        placeholderTextColor={c.muted}
        value={value}
        onChangeText={onChange}
      />
    </View>
  );
}

function signed(net: number, currency: string): string {
  const money = formatMoney(Math.abs(net), currency);
  return `${net < 0 ? '−' : '+'}${money}`;
}

function shortDate(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(ms));
}

function parseYmd(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}
