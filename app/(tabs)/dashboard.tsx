/**
 * Dashboard — net worth, period totals, and a spend-over-time chart. Reads
 * live data from the local DB and computes figures with the pure domain layer.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import {
  accountBalances,
  netWorth,
  totalAssets,
  totalLiabilities,
} from '../../src/domain/balances';
import { Granularity, groupByPeriod, periodRange, totalsForRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { Card } from '../../src/components/ui/Card';
import { Stat } from '../../src/components/ui/Stat';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Sparkline } from '../../src/components/ui/Sparkline';
import { ListRow } from '../../src/components/ui/ListRow';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { accountIcon } from '../../src/lib/accountIcon';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

export default function DashboardScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [granularity, setGranularity] = useState<Granularity>('month');

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

  const figures = useMemo(() => {
    const range = periodRange(Date.now(), granularity);
    const series = groupByPeriod(transactions, granularity);
    return {
      net: netWorth(accounts, transactions),
      assets: totalAssets(accounts, transactions),
      liabilities: totalLiabilities(accounts, transactions),
      period: totalsForRange(transactions, range),
      trend: series.map((b) => b.totals.net),
    };
  }, [accounts, transactions, granularity]);

  const balances = useMemo(
    () => accountBalances(accounts, transactions),
    [accounts, transactions]
  );
  const active = accounts.filter((a) => !a.archived);
  const assetAccounts = active.filter((a) => a.type === 'asset');
  const liabilityAccounts = active.filter((a) => a.type === 'liability');

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
      <Text className="text-text text-[28px] font-extrabold mb-4">Overview</Text>

      <View className="bg-[#1B2540] border border-[#33406e] rounded-lg p-5 mb-4">
        <Text className="text-[#c9d4ec] text-sm font-semibold">Net worth</Text>
        <Text className="text-white text-[36px] font-extrabold mt-1">
          {formatMoney(figures.net)}
        </Text>
        {figures.trend.length > 1 ? (
          <View className="mt-3">
            <Sparkline values={figures.trend} />
          </View>
        ) : (
          <Text className="text-[#8a97b8] text-xs mt-3">
            Add a few transactions to see your trend.
          </Text>
        )}
      </View>

      <View className="flex-row mb-4" style={{ gap: 12 }}>
        <Stat label="Assets" value={formatMoney(figures.assets)} tone="positive" />
        <Stat label="Liabilities" value={formatMoney(figures.liabilities)} tone="negative" />
      </View>

      <View className="mb-4">
        <SegmentedControl
          options={GRANULARITIES}
          value={granularity}
          onChange={setGranularity}
        />
      </View>

      <Card>
        <Text className="text-text text-base font-semibold capitalize mb-3">
          This {granularity}
        </Text>
        <View className="flex-row" style={{ gap: 12 }}>
          <Stat label="Spent" value={formatMoney(figures.period.expense)} tone="negative" />
          <Stat label="Earned" value={formatMoney(figures.period.income)} tone="positive" />
        </View>
      </Card>

      {active.length === 0 ? (
        <Text className="text-muted text-sm mt-6">
          No accounts yet. Add one from Settings → Manage accounts.
        </Text>
      ) : (
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
