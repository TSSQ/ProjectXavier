/**
 * Dashboard — a period-scoped overview. A period button (top-left) opens the
 * Period sheet (Month / Year / Date). For the selected period the screen shows
 * net worth at the period end with a per-account trend chart, the period's
 * income / expense / net, then each account's closing balance (rolled forward
 * from the previous period's close). Tap an account to drill in.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import {
  accountPeriodBalances,
  netWorthAsOf,
  balanceSeries,
} from '../../src/domain/balances';
import { totalsForRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../../src/features/settings/repository';
import { accountIcon } from '../../src/lib/accountIcon';
import { accountColor } from '../../src/lib/accountColor';
import { MultiLineChart } from '../../src/components/ui/MultiLineChart';
import {
  PeriodSheet,
  PeriodSelection,
  currentMonthSelection,
} from '../../src/components/ui/PeriodSheet';

const CHART_STEPS = 16;

export default function DashboardScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [sel, setSel] = useState<PeriodSelection>(() => currentMonthSelection());
  const [sheetOpen, setSheetOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextTransactions, nextCurrency] = await Promise.all([
      listAccounts(),
      listTransactions(),
      getCurrency(),
    ]);
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setCurrency(nextCurrency);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const range = useMemo(() => ({ start: sel.start, end: sel.end }), [sel]);
  const totals = useMemo(
    () => totalsForRange(transactions, range),
    [transactions, range]
  );
  const periodAccounts = useMemo(
    () => accountPeriodBalances(accounts, transactions, range),
    [accounts, transactions, range]
  );
  const netEnd = useMemo(
    () => netWorthAsOf(accounts, transactions, range.end - 1),
    [accounts, transactions, range]
  );

  const sampleTimes = useMemo(() => {
    const span = Math.max(1, range.end - 1 - range.start);
    return Array.from({ length: CHART_STEPS + 1 }, (_, i) =>
      range.start + Math.round((span * i) / CHART_STEPS)
    );
  }, [range]);

  const series = useMemo(
    () =>
      periodAccounts.map((p, i) => ({
        color: accountColor(i),
        values: balanceSeries(p.account, transactions, sampleTimes),
      })),
    [periodAccounts, transactions, sampleTimes]
  );

  const netTone = totals.net < 0 ? 'text-negative' : 'text-positive';

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {/* top bar: period button (left) + actions (right) */}
        <View className="flex-row items-center justify-between mb-2">
          <Pressable
            onPress={() => setSheetOpen(true)}
            className="flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2"
            accessibilityLabel="Change period"
          >
            <Feather name="calendar" size={14} color="#9AA4B2" />
            <Text className="text-text text-[13px] font-bold ml-2">{sel.label}</Text>
            <Feather name="chevron-down" size={14} color="#9AA4B2" style={{ marginLeft: 4 }} />
          </Pressable>
          <View className="flex-row" style={{ gap: 8 }}>
            <View className="w-8 h-8 rounded-full bg-surfaceAlt border border-border items-center justify-center">
              <Feather name="search" size={14} color="#9AA4B2" />
            </View>
            <View className="w-8 h-8 rounded-full bg-surfaceAlt border border-border items-center justify-center">
              <Feather name="more-horizontal" size={14} color="#9AA4B2" />
            </View>
          </View>
        </View>

        <Text className="text-text text-[28px] font-extrabold mb-3">Overview</Text>

        {/* hero: net worth at period end + per-account trend */}
        <View className="bg-surface border border-border rounded-lg p-4 mb-3">
          <Text className="text-muted text-xs font-semibold">
            Account balances · {sel.label}
          </Text>
          <Text className="text-text text-[26px] font-extrabold mt-0.5">
            {formatMoney(netEnd, currency)}
          </Text>
          {series.length > 0 && (
            <>
              <View className="mt-2">
                <MultiLineChart series={series} />
              </View>
              <View className="flex-row flex-wrap mt-2.5" style={{ gap: 10 }}>
                {periodAccounts.map((p, i) => (
                  <View key={p.account.id} className="flex-row items-center" style={{ gap: 5 }}>
                    <View
                      style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: accountColor(i) }}
                    />
                    <Text className="text-muted text-[10px]">{p.account.name}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {/* income / expense */}
        <View className="flex-row mb-2.5" style={{ gap: 8 }}>
          <View className="flex-1 bg-surface border border-border rounded-md px-3 py-2.5">
            <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">Income</Text>
            <Text className="text-positive text-base font-extrabold mt-0.5">
              +{formatMoney(totals.income, currency)}
            </Text>
          </View>
          <View className="flex-1 bg-surface border border-border rounded-md px-3 py-2.5">
            <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">Expense</Text>
            <Text className="text-negative text-base font-extrabold mt-0.5">
              −{formatMoney(totals.expense, currency)}
            </Text>
          </View>
        </View>

        {/* net savings / spending */}
        <View className="bg-[#1B2540] border border-[#33406e] rounded-lg px-4 py-3 mb-4">
          <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">
            {totals.net < 0 ? 'Net spending' : 'Net savings'}
          </Text>
          <Text className={`text-[22px] font-extrabold mt-0.5 ${netTone}`}>
            {totals.net < 0 ? '−' : '+'}
            {formatMoney(Math.abs(totals.net), currency)}
          </Text>
        </View>

        {/* accounts as of period */}
        {periodAccounts.length === 0 ? (
          <Text className="text-muted text-sm">
            No accounts yet — add one from Settings → Manage accounts.
          </Text>
        ) : (
          <>
            <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mb-2.5">
              Accounts — as of {sel.label}
            </Text>
            {periodAccounts.map((p, i) => {
              const { emoji, bg } = accountIcon(p.account);
              const meta = [p.account.subtype, p.account.tag].filter(Boolean).join(' · ');
              const chgTone =
                p.change === 0 ? 'text-muted' : p.change < 0 ? 'text-negative' : 'text-positive';
              return (
                <Pressable
                  key={p.account.id}
                  onPress={() => router.push(`/account/${p.account.id}`)}
                  className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
                >
                  <View className={`w-10 h-10 rounded-xl items-center justify-center ${bg}`}>
                    <View
                      style={{
                        position: 'absolute',
                        left: -3,
                        top: -3,
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        borderWidth: 2,
                        borderColor: '#0E1116',
                        backgroundColor: accountColor(i),
                      }}
                    />
                    <Text className="text-lg">{emoji}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-text text-sm font-semibold">{p.account.name}</Text>
                    <Text className="text-muted text-xs mt-0.5">
                      start {formatMoney(p.start, currency)}
                      {meta ? ` · ${meta}` : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-[15px] font-extrabold ${p.close < 0 ? 'text-negative' : 'text-text'}`}
                    >
                      {formatMoney(p.close, currency)}
                    </Text>
                    <Text className={`text-[10px] mt-0.5 ${chgTone}`}>
                      {p.change === 0
                        ? 'no change'
                        : `${p.change < 0 ? '−' : '+'}${formatMoney(Math.abs(p.change), currency)}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      <PeriodSheet
        visible={sheetOpen}
        initialMode={sel.mode}
        transactions={transactions}
        currency={currency}
        onSelect={(next) => {
          setSel(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}
