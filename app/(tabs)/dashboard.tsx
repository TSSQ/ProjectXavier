/**
 * Dashboard — the financial overview. A period filter (Month / Year / custom
 * Range) sits at the top-left. Net worth is the sum of every account balance.
 * Month/Year list each period (newest first) with its net flow; tap one to
 * drill into just that period. Below is the per-account overview.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import { accountBalances, netWorth } from '../../src/domain/balances';
import { PeriodSummary, periodsUpToNow } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Sparkline } from '../../src/components/ui/Sparkline';
import { ListRow } from '../../src/components/ui/ListRow';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { Button } from '../../src/components/ui/Button';
import { accountIcon } from '../../src/lib/accountIcon';

type Mode = 'month' | 'year' | 'range';
const MODES: Mode[] = ['month', 'year', 'range'];
const DAY_MS = 24 * 60 * 60 * 1000;

export default function DashboardScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [mode, setMode] = useState<Mode>('month');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextTransactions] = await Promise.all([
      listAccounts(),
      listTransactions(),
    ]);
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const net = useMemo(() => netWorth(accounts, transactions), [accounts, transactions]);
  const periods = useMemo(
    () => (mode === 'range' ? [] : periodsUpToNow(transactions, mode)),
    [transactions, mode]
  );
  // Sparkline wants oldest→newest; periods are newest-first.
  const trend = useMemo(
    () => [...periods].reverse().map((p) => p.totals.net),
    [periods]
  );

  const balances = useMemo(
    () => accountBalances(accounts, transactions),
    [accounts, transactions]
  );
  const active = accounts.filter((a) => !a.archived);
  const assetAccounts = active.filter((a) => a.type === 'asset');
  const liabilityAccounts = active.filter((a) => a.type === 'liability');

  const openPeriod = (p: PeriodSummary, label: string) =>
    router.push({
      pathname: '/period',
      params: { start: String(p.start), end: String(p.end), label },
    });

  const viewRange = () => {
    const start = parseYmd(rangeStart);
    const end = parseYmd(rangeEnd);
    if (start === null || end === null) {
      setRangeError('Use dates like 2026-01-31.');
      return;
    }
    if (end < start) {
      setRangeError('End date must be on or after the start date.');
      return;
    }
    setRangeError(null);
    router.push({
      pathname: '/period',
      params: {
        start: String(start),
        end: String(end + DAY_MS), // make the end date inclusive
        label: `${rangeStart} → ${rangeEnd}`,
      },
    });
  };

  const renderPeriodRow = (p: PeriodSummary) => {
    const label = periodLabel(p.start, mode === 'range' ? 'month' : mode);
    return (
      <ListRow
        key={p.start}
        title={label}
        subtitle={`In ${formatMoney(p.totals.income)} · Out ${formatMoney(p.totals.expense)}`}
        value={formatMoney(p.totals.net)}
        tone={p.totals.net < 0 ? 'negative' : 'positive'}
        onPress={() => openPeriod(p, label)}
      />
    );
  };

  const renderAccount = (a: Account) => {
    const bal = balances.get(a.id) ?? a.openingBalance;
    const { emoji, bg } = accountIcon(a);
    return (
      <ListRow
        key={a.id}
        icon={emoji}
        iconClassName={bg}
        title={a.name}
        subtitle={`${a.subtype ?? a.type} · ${a.currency}`}
        value={formatMoney(bal, a.currency)}
        tone={bal < 0 ? 'negative' : 'positive'}
        onPress={() => router.push(`/account/${a.id}`)}
      />
    );
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-text text-[28px] font-extrabold mb-3">Overview</Text>

      <View className="mb-4">
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />
      </View>

      <View className="bg-[#1B2540] border border-[#33406e] rounded-lg p-5 mb-4">
        <Text className="text-[#c9d4ec] text-sm font-semibold">Net worth</Text>
        <Text className="text-white text-[36px] font-extrabold mt-1">
          {formatMoney(net)}
        </Text>
        {mode !== 'range' && trend.length > 1 ? (
          <View className="mt-3">
            <Sparkline values={trend} />
          </View>
        ) : null}
      </View>

      {mode === 'range' ? (
        <View className="mb-2">
          <SectionLabel>Date range</SectionLabel>
          <View className="flex-row" style={{ gap: 8 }}>
            <TextInput
              className="flex-1 bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
              placeholder="Start YYYY-MM-DD"
              placeholderTextColor="#9AA4B2"
              value={rangeStart}
              onChangeText={setRangeStart}
            />
            <TextInput
              className="flex-1 bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
              placeholder="End YYYY-MM-DD"
              placeholderTextColor="#9AA4B2"
              value={rangeEnd}
              onChangeText={setRangeEnd}
            />
          </View>
          {rangeError && (
            <Text className="text-negative text-xs mt-2">{rangeError}</Text>
          )}
          <View className="mt-3">
            <Button title="View range" onPress={viewRange} />
          </View>
        </View>
      ) : (
        <View className="mb-2">
          <SectionLabel>{mode === 'year' ? 'By year' : 'By month'}</SectionLabel>
          {periods.length === 0 ? (
            <Text className="text-muted text-sm">
              No transactions yet — add one from the Assistant.
            </Text>
          ) : (
            periods.map(renderPeriodRow)
          )}
        </View>
      )}

      {active.length > 0 && (
        <View className="mt-4">
          {assetAccounts.length > 0 && <SectionLabel>Assets</SectionLabel>}
          {assetAccounts.map(renderAccount)}
          {liabilityAccounts.length > 0 && <SectionLabel>Liabilities</SectionLabel>}
          {liabilityAccounts.map(renderAccount)}
        </View>
      )}
    </ScrollView>
  );
}

function periodLabel(start: number, mode: 'month' | 'year'): string {
  const d = new Date(start);
  if (mode === 'year') return String(d.getUTCFullYear());
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
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
