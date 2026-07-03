/**
 * Period detail — all data within a single period (a month, a year, or a custom
 * date range), reached from the dashboard. Shows the period's net/in/out totals
 * and its transactions grouped by day.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Transaction } from '../src/domain/types';
import { inRange, totalsForRange } from '../src/domain/period';
import { formatMoney } from '../src/domain/money';
import { listAccounts } from '../src/features/accounts/repository';
import { listTransactions } from '../src/features/transactions/repository';
import { listCategories } from '../src/features/categories/repository';
import { listPayees } from '../src/features/payees/repository';
import { groupTransactionsByDay } from '../src/lib/grouping';
import { TransactionRow } from '../src/components/ui/TransactionRow';
import { Card } from '../src/components/ui/Card';
import { Stat } from '../src/components/ui/Stat';
import { colors } from '../src/theme/tokens';

export default function PeriodScreen() {
  const params = useLocalSearchParams<{ start: string; end: string; label: string }>();
  const router = useRouter();
  const start = Number(params.start);
  const end = Number(params.end);
  const label = params.label ?? 'Period';

  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [payeeNames, setPayeeNames] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    const [txs, accts, cats, pys] = await Promise.all([
      listTransactions(),
      listAccounts(),
      listCategories(),
      listPayees(),
    ]);
    setAllTx(txs);
    setAccountNames(new Map(accts.map((a) => [a.id, a.name])));
    setCategoryNames(new Map(cats.map((c) => [c.id, c.name])));
    setPayeeNames(new Map(pys.map((p) => [p.id, p.name])));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const range = useMemo(() => ({ start, end }), [start, end]);
  const periodTx = useMemo(
    () => allTx.filter((tx) => inRange(tx, range)),
    [allTx, range]
  );
  const totals = useMemo(() => totalsForRange(allTx, range), [allTx, range]);
  const sections = useMemo(
    () => groupTransactionsByDay(periodTx),
    [periodTx]
  );

  return (
    <View className="flex-1 bg-bg">
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: 24, paddingTop: 56 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View className="mb-2">
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center mb-4"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={22} color={colors.textMuted} />
              <Text className="text-muted text-base ml-1">Back</Text>
            </Pressable>

            <Text className="text-text text-[22px] font-extrabold mb-3">{label}</Text>

            <Card style={{ gap: 12 }} className="mb-2">
              <View>
                <Text className="text-muted text-xs font-semibold">Net</Text>
                <Text
                  className={`text-[28px] font-extrabold mt-0.5 ${
                    totals.net < 0 ? 'text-negative' : 'text-positive'
                  }`}
                >
                  {formatMoney(totals.net)}
                </Text>
              </View>
              <View className="flex-row" style={{ gap: 12 }}>
                <Stat label="Earned" value={formatMoney(totals.income)} tone="positive" />
                <Stat label="Spent" value={formatMoney(totals.expense)} tone="negative" />
              </View>
            </Card>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-muted text-center mt-6">
            No transactions in this period.
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mt-4 mb-2.5">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
            accountName={accountNames.get(item.accountId)}
            transferAccountName={
              item.transferAccountId
                ? accountNames.get(item.transferAccountId)
                : undefined
            }
            categoryName={
              item.categoryId ? categoryNames.get(item.categoryId) : undefined
            }
            payeeName={item.payeeId ? payeeNames.get(item.payeeId) : undefined}
          />
        )}
      />
    </View>
  );
}
