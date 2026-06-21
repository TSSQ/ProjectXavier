/**
 * Dashboard — net worth, period totals, and a spend-over-time chart. Reads
 * live data from the local DB and computes figures with the pure domain layer.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import { netWorth, totalAssets, totalLiabilities } from '../../src/domain/balances';
import { Granularity, groupByPeriod, periodRange, totalsForRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { colors, spacing, radius, typography } from '../../src/theme/tokens';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

export default function DashboardScreen() {
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
    return {
      net: netWorth(accounts, transactions),
      assets: totalAssets(accounts, transactions),
      liabilities: totalLiabilities(accounts, transactions),
      period: totalsForRange(transactions, range),
      series: groupByPeriod(transactions, granularity),
    };
  }, [accounts, transactions, granularity]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>Net worth</Text>
      <Text style={styles.netWorth}>{formatMoney(figures.net)}</Text>

      <View style={styles.row}>
        <Stat label="Assets" value={formatMoney(figures.assets)} tone="positive" />
        <Stat label="Liabilities" value={formatMoney(figures.liabilities)} tone="negative" />
      </View>

      <View style={styles.segment}>
        {GRANULARITIES.map((g) => (
          <Pressable
            key={g}
            onPress={() => setGranularity(g)}
            style={[styles.segmentItem, granularity === g && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, granularity === g && styles.segmentTextActive]}>
              {g}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>This {granularity}</Text>
        <View style={styles.row}>
          <Stat label="Spent" value={formatMoney(figures.period.expense)} tone="negative" />
          <Stat label="Earned" value={formatMoney(figures.period.income)} tone="positive" />
        </View>
        <Text style={styles.cardHint}>
          {figures.series.length} period(s) of history available for charts.
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'positive' && { color: colors.positive },
          tone === 'negative' && { color: colors.negative },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.textMuted, fontSize: typography.body },
  netWorth: { color: colors.text, fontSize: 40, fontWeight: '700', marginBottom: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md },
  statLabel: { color: colors.textMuted, fontSize: typography.caption },
  statValue: { color: colors.text, fontSize: typography.heading, fontWeight: '600', marginTop: 4 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    marginVertical: spacing.lg,
  },
  segmentItem: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.textMuted, textTransform: 'capitalize' },
  segmentTextActive: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  cardLabel: { color: colors.text, fontSize: typography.heading, fontWeight: '600', textTransform: 'capitalize' },
  cardHint: { color: colors.textMuted, fontSize: typography.caption },
});
