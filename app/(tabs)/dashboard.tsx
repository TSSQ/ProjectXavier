/**
 * Dashboard — a period-scoped overview. A period button (top-left) opens the
 * Period sheet (Month / Year / Date). For the selected period the screen shows
 * net worth at the period end with a per-account trend chart, the period's
 * income / expense / net, then each account's closing balance (rolled forward
 * from the previous period's close). Tap an account to drill in.
 *
 * Below the accounts section: a Planned list of upcoming recurring transactions
 * and a projected net-worth figure 30 days out.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Transaction, RecurringSeries } from '../../src/domain/types';
import {
  accountPeriodBalances,
  netWorthAsOf,
  balanceSeries,
} from '../../src/domain/balances';
import { totalsForRange, cashFlowSeries, Granularity } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../../src/features/settings/repository';
import { listSeries } from '../../src/features/recurring/repository';
import { upcomingOccurrences, forecastNetWorth } from '../../src/domain/recurrence';
import { accountIcon } from '../../src/lib/accountIcon';
import { accountColor } from '../../src/lib/accountColor';
import { MultiLineChart } from '../../src/components/ui/MultiLineChart';
import { BarChart } from '../../src/components/ui/BarChart';
import { colors } from '../../src/theme/tokens';
import { PeriodSheet } from '../../src/components/ui/PeriodSheet';

const CHART_STEPS = 16;
const FORECAST_DAYS = 30;
const PLANNED_LIMIT = 6;

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const { sel, setSel } = usePeriod();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chartPage, setChartPage] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  // card sits inside 24px horizontal padding on each side
  const slideWidth = screenWidth - 48;

  const refresh = useCallback(async () => {
    const [nextAccounts, nextTransactions, nextCurrency, series] = await Promise.all([
      listAccounts(),
      listTransactions(),
      getCurrency(),
      listSeries(),
    ]);
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setCurrency(nextCurrency);
    setAllSeries(series.filter((s) => !s.archived));
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

  const barGranularity = useMemo<Granularity>(
    () => (sel.mode === 'year' ? 'month' : 'day'),
    [sel.mode]
  );

  const cashFlow = useMemo(
    () => cashFlowSeries(transactions, range, barGranularity),
    [transactions, range, barGranularity]
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

  // Forecast net worth 30 days from now.
  const forecastValue = useMemo(() => {
    const now = Date.now();
    const until = now + FORECAST_DAYS * 86_400_000;
    return forecastNetWorth(netEnd, allSeries, now, until, currency);
  }, [netEnd, allSeries, currency]);

  const forecastDelta = forecastValue - netEnd;

  // Upcoming planned occurrences across all series for the Planned list.
  const plannedItems = useMemo(() => {
    const now = Date.now();
    const items: { key: string; series: RecurringSeries; date: number }[] = [];
    for (const s of allSeries) {
      if (s.paused) continue;
      const dates = upcomingOccurrences(s, now, 3);
      for (const date of dates) {
        items.push({ key: `${s.id}-${date}`, series: s, date });
      }
    }
    return items.sort((a, b) => a.date - b.date).slice(0, PLANNED_LIMIT);
  }, [allSeries]);

  const netTone = totals.net < 0 ? 'text-negative' : 'text-positive';

  const fmtDate = (epoch: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(epoch),
    );

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12 }}>
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

        {/* combined chart card — swipe left/right to switch views */}
        <View className="bg-surface border border-border rounded-lg mb-3">
          {/* always-visible header: net worth + dynamic chart title */}
          <View className="px-4 pt-4 pb-1">
            <Text className="text-muted text-xs font-semibold">
              {chartPage === 0 ? 'Account balances' : 'Cash flow'} · {sel.label}
            </Text>
            <Text className="text-text text-[26px] font-extrabold mt-0.5">
              {formatMoney(netEnd, currency)}
            </Text>
            {forecastDelta !== 0 && (
              <Text className="text-muted text-[12px] mt-0.5">
                Projected in {FORECAST_DAYS}d:{' '}
                <Text
                  className={
                    forecastValue >= netEnd ? 'text-positive' : 'text-negative'
                  }
                >
                  {forecastValue >= netEnd ? '+' : '−'}
                  {formatMoney(Math.abs(forecastDelta), currency)}
                </Text>
              </Text>
            )}
          </View>

          {/* horizontally paged charts */}
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) =>
              setChartPage(Math.round(e.nativeEvent.contentOffset.x / slideWidth))
            }
          >
            {/* slide 0: account balance trend */}
            <View style={{ width: slideWidth, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
              {series.length > 0 ? (
                <>
                  <MultiLineChart series={series} />
                  <View className="flex-row flex-wrap mt-2" style={{ gap: 10 }}>
                    {periodAccounts.map((p, i) => (
                      <View key={p.account.id} className="flex-row items-center" style={{ gap: 5 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: accountColor(i) }} />
                        <Text className="text-muted text-[10px]">{p.account.name}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text className="text-muted text-xs text-center py-8">No accounts yet.</Text>
              )}
            </View>

            {/* slide 1: income vs expense cash flow */}
            <View style={{ width: slideWidth, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
              {cashFlow.length > 1 ? (
                <>
                  <BarChart data={cashFlow} />
                  <View className="flex-row mt-2" style={{ gap: 14 }}>
                    <View className="flex-row items-center" style={{ gap: 5 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.positive }} />
                      <Text className="text-muted text-[10px]">Income</Text>
                    </View>
                    <View className="flex-row items-center" style={{ gap: 5 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.negative }} />
                      <Text className="text-muted text-[10px]">Expenses</Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text className="text-muted text-xs text-center py-8">No transactions this period.</Text>
              )}
            </View>
          </ScrollView>

          {/* page dots */}
          <View className="flex-row justify-center pb-3 pt-1" style={{ gap: 5 }}>
            {[0, 1].map((i) => (
              <View
                key={i}
                style={{
                  width: i === chartPage ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === chartPage ? colors.primary : colors.border,
                }}
              />
            ))}
          </View>
        </View>

        {/* income / expense stat tiles */}
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

        {/* Planned recurring transactions */}
        {plannedItems.length > 0 && (
          <View className="mb-4">
            <View className="flex-row items-center justify-between mx-1 mb-2.5">
              <Text className="text-muted text-xs font-bold uppercase tracking-wide">
                Planned
              </Text>
              <Pressable
                onPress={() => router.push('/recurring')}
                className="flex-row items-center"
                style={{ gap: 4 }}
                accessibilityLabel="Manage recurring transactions"
              >
                <Text className="text-[#5fd497] text-[12px] font-semibold">Manage</Text>
                <Feather name="chevron-right" size={12} color="#5fd497" />
              </Pressable>
            </View>
            {plannedItems.map((item) => {
              const { series, date } = item;
              const signed =
                series.template.type === 'income'
                  ? series.template.amount
                  : -series.template.amount;
              const iconBg =
                series.template.type === 'income'
                  ? 'bg-[#1c3a2e]'
                  : series.template.type === 'transfer'
                    ? 'bg-[#13314a]'
                    : 'bg-[#3a2330]';
              return (
                <View
                  key={item.key}
                  className="flex-row items-center gap-3 bg-surface border border-border/50 rounded-md p-3.5 mb-2 opacity-70"
                >
                  <View className={`w-10 h-10 rounded-xl items-center justify-center ${iconBg}`}>
                    <Text className="text-lg">🔁</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-text text-sm font-semibold">
                      {series.template.type.charAt(0).toUpperCase() +
                        series.template.type.slice(1)}
                    </Text>
                    <Text className="text-muted text-xs mt-0.5">{fmtDate(date)}</Text>
                  </View>
                  <Text
                    className={`text-[15px] font-bold ${
                      series.template.type === 'transfer'
                        ? 'text-muted'
                        : signed >= 0
                          ? 'text-positive'
                          : 'text-negative'
                    }`}
                  >
                    {formatMoney(signed, series.template.currency)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

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
                  onPress={() =>
                    router.push({
                      pathname: '/account/[id]',
                      params: {
                        id: p.account.id,
                        start: String(sel.start),
                        end: String(sel.end),
                        label: sel.label,
                      },
                    })
                  }
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

        {/* Manage recurring shortcut (when there are no planned items but series exist) */}
        {allSeries.length > 0 && plannedItems.length === 0 && (
          <Pressable
            onPress={() => router.push('/recurring')}
            className="flex-row items-center justify-between bg-surface border border-border rounded-md px-4 py-3 mb-2"
          >
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <Text className="text-lg">🔁</Text>
              <Text className="text-text text-sm font-semibold">Recurring transactions</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9AA4B2" />
          </Pressable>
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
