/**
 * Budget category detail (docs/design/monthly-budgets-spec.md §5.4): what is
 * left in one category for a month, the scheduled items that are already
 * counted against it, and the transactions paid so far. Reached by tapping a
 * budgeted row on the Budget screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ICON } from '../../src/theme/assets';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { BudgetBar } from '../../src/components/ui/BudgetBar';
import { BudgetEditSheet, BudgetEditTarget } from '../../src/components/budgets/BudgetEditSheet';
import { BudgetLegend } from '../../src/components/budgets/BudgetCard';
import { BudgetMonthPicker } from '../../src/components/budgets/BudgetMonthPicker';
import { useBudgetData } from '../../src/features/budgets/useBudgetData';
import { setBudget } from '../../src/features/budgets/repository';
import {
  BudgetScope,
  MonthKey,
  ScheduledItem,
  budgetFor,
  computeBudgets,
  isMonthKey,
  monthKeyOf,
  threeMonthAverages,
} from '../../src/domain/budgets';
import { formatBudgetMoney } from '../../src/domain/budgetCopy';
import { formatMoney } from '../../src/domain/money';
import { shortMonthDay } from '../../src/domain/dates';
import { seriesTitle } from '../../src/domain/recurrence';
import { warnColor } from '../../src/components/ui/StatusChip';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export default function BudgetCategoryScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId: string; month?: string }>();
  const categoryId = params.categoryId;
  const { data, refresh } = useBudgetData();
  const [month, setMonth] = useState<MonthKey>(() =>
    params.month && isMonthKey(params.month) ? params.month : monthKeyOf(Date.now())
  );
  // Defensive sync: adopt a new `month` param if one arrives while mounted.
  useEffect(() => {
    if (params.month && isMonthKey(params.month)) setMonth(params.month);
  }, [params.month]);
  const [editing, setEditing] = useState<BudgetEditTarget | null>(null);

  const { currency, categories, now, payees } = data;
  const category = categories.find((x) => x.id === categoryId);
  const payeeName = (id: string | null | undefined) =>
    id ? payees.find((p) => p.id === id)?.name : undefined;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'Account';

  const summary = useMemo(
    () =>
      computeBudgets({
        transactions: data.transactions,
        series: data.series,
        categories,
        rows: data.rows,
        now,
        month,
      }),
    [data.transactions, data.series, categories, data.rows, now, month]
  );
  const view = summary.categories.find((v) => v.categoryId === categoryId);
  const name = category?.name ?? 'Category';
  const icon = category?.icon ?? '🏷️';

  const openEdit = () => {
    if (!category || !categoryId) return;
    const avg = threeMonthAverages(
      { transactions: data.transactions, categories, now, month },
      currency
    ).get(categoryId);
    setEditing({
      categoryId,
      name,
      icon: category.icon ?? null,
      current: budgetFor(data.rows, categoryId, month),
      average: avg ?? 0,
    });
  };

  const [error, setError] = useState<string | null>(null);
  const onSave = async (id: string, amount: number | null, scope: BudgetScope) => {
    try {
      setError(null);
      await setBudget({ categoryId: id, amount, month, scope });
      setEditing(null);
      await refresh();
    } catch {
      setError("Couldn't save that budget. Please try again.");
    }
  };

  const scheduled = (view?.items ?? []).slice().sort((a, b) => a.date - b.date);
  const paid = (view?.paid ?? []).slice().sort((a, b) => b.occurredAt - a.occurredAt);

  const itemTitle = (it: ScheduledItem): string => {
    if (it.kind === 'recurring') {
      const s = data.series.find((x) => x.id === it.seriesId);
      return s
        ? seriesTitle(s.template, { payeeName: payeeName(s.template.payeeId), categoryName: name })
        : name;
    }
    return payeeName(it.payeeId) ?? it.note ?? name;
  };
  const itemSub = (it: ScheduledItem): string =>
    `${shortMonthDay(it.date)} · ${
      it.kind === 'recurring' ? 'Recurring' : it.kind === 'pending' ? 'Pending' : 'Future-dated'
    }`;

  const left = view ? view.left : 0;
  const leftColor = view?.state === 'over' ? c.negative : view?.state === 'warn' ? warnColor(c) : c.text;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 py-3">
        <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
          <Pressable hitSlop={8} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
            <Feather name="chevron-left" size={ICON.lg} color={c.primary} />
          </Pressable>
          <Text numberOfLines={1} className="text-text text-2xl font-extrabold flex-1">
            {icon} {name}
          </Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Pressable onPress={openEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit budget">
            <Text style={{ color: c.primary, fontSize: 14, fontWeight: '600' }}>Edit</Text>
          </Pressable>
          <BudgetMonthPicker
            month={month}
            now={now || Date.now()}
            transactions={data.transactions}
            budgetRows={data.rows}
            currency={currency}
            onChange={setMonth}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 60, gap: 10 }}>
        {error && (
          <Text style={{ color: c.negative, fontSize: 13 }} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {view ? (
          <View className="bg-surface border border-borderAccent rounded-lg" style={{ padding: 14 }}>
            <Text className="text-muted text-[12px] font-bold uppercase tracking-wide">
              Left in {name}
            </Text>
            <View className="flex-row items-baseline flex-wrap" style={{ gap: 6 }}>
              <Text style={{ ...TABULAR, color: leftColor, fontSize: 28, fontWeight: '800', letterSpacing: -0.3 }}>
                {left < 0 ? `${formatBudgetMoney(-left, currency)} over` : formatBudgetMoney(left, currency)}
              </Text>
              <Text className="text-muted text-[13px]" style={TABULAR}>
                of {formatBudgetMoney(view.budget, currency)}
              </Text>
            </View>
            <BudgetBar
              budget={view.budget}
              spent={view.spent}
              scheduled={view.scheduled}
              state={view.state}
              tick={view.tick !== null && view.state !== 'over' && view.scheduled === 0 ? view.tick : null}
            />
            <View style={{ marginTop: 7 }}>
              <BudgetLegend
                summary={view}
                currency={currency}
                spentLabel="Paid"
              />
            </View>
          </View>
        ) : (
          <View className="bg-surface border border-border rounded-md" style={{ padding: 14 }}>
            <Text className="text-muted text-[13px]">
              {name} has no budget for this month. Tap Edit to set one.
            </Text>
          </View>
        )}

        {scheduled.length > 0 && (
          <>
            <Text className="text-muted text-[12px] font-bold uppercase tracking-wide px-1 pt-0.5">
              Scheduled · {scheduled.length}
            </Text>
            <View className="bg-surface border border-border rounded-md" style={{ padding: 12, gap: 12 }}>
              {scheduled.map((it, i) => (
                <View key={`${it.seriesId ?? it.txId}-${it.date}-${i}`} className="flex-row items-center" style={{ gap: 10 }}>
                  <View className="w-9 h-9 rounded-md bg-badgeFlat items-center justify-center">
                    <Text className="text-lg">{it.kind === 'recurring' ? '🔁' : '📅'}</Text>
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-text text-[14px] font-semibold">
                      {itemTitle(it)}
                    </Text>
                    <Text className="text-muted text-[11px]">{itemSub(it)}</Text>
                  </View>
                  <Text className="text-muted text-[14px] font-bold" style={TABULAR}>
                    {formatMoney(it.amount, currency)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {paid.length > 0 && (
          <>
            <Text className="text-muted text-[12px] font-bold uppercase tracking-wide px-1 pt-0.5">
              Paid · {paid.length}
            </Text>
            <View className="bg-surface border border-border rounded-md" style={{ padding: 12, gap: 12 }}>
              {paid.map((tx) => {
                const refund = tx.type === 'income';
                const txCat = categories.find((x) => x.id === tx.categoryId);
                return (
                  <Pressable
                    key={tx.id}
                    onPress={() =>
                      router.navigate({
                        pathname: '/transactions',
                        params: { edit: `${tx.id}@${Date.now()}` },
                      })
                    }
                    className="flex-row items-center"
                    style={{ gap: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${payeeName(tx.payeeId) ?? tx.note ?? name}`}
                  >
                    <View className="w-9 h-9 rounded-md bg-badgeFlat items-center justify-center">
                      <Text className="text-lg">{txCat?.icon ?? icon}</Text>
                    </View>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-text text-[14px] font-semibold">
                        {payeeName(tx.payeeId) ?? tx.note ?? txCat?.name ?? name}
                      </Text>
                      <Text className="text-muted text-[11px]">
                        {shortMonthDay(tx.occurredAt)} · {accountName(tx.accountId)}
                      </Text>
                    </View>
                    <Text
                      className={`text-[14px] font-bold ${refund ? 'text-positive' : 'text-negative'}`}
                      style={TABULAR}
                    >
                      {refund ? '+' : '−'}
                      {formatMoney(tx.amount, currency)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <BudgetEditSheet
        visible={editing !== null}
        target={editing}
        month={month}
        currency={currency}
        onClose={() => setEditing(null)}
        onSave={onSave}
      />
    </View>
  );
}
