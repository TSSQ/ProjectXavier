/**
 * Budget — the monthly category budgets screen (docs/design/monthly-budgets-
 * spec.md §5.2). A pushed route like Recurring, not a tab: reached from the
 * dashboard card's "All budgets ›" and from a Settings row. Opens on the
 * dashboard's month (the `month` param) or the current month.
 *
 * First run (no budget rows at all) offers 3-month-average suggestions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ICON } from '../src/theme/assets';
import { useThemeColors } from '../src/theme/useThemeColors';
import { radius } from '../src/theme/tokens';
import { Button } from '../src/components/ui/Button';
import { TextAction } from '../src/components/ui/TextAction';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { BudgetBar, TodayLabel } from '../src/components/ui/BudgetBar';
import { AssistantAvatar } from '../src/components/AssistantAvatar';
import { BudgetCategoryRow, CategoryIcon } from '../src/components/budgets/BudgetCategoryRow';
import { BudgetHeadline, BudgetLegend } from '../src/components/budgets/BudgetCard';
import { BudgetEditSheet, BudgetEditTarget } from '../src/components/budgets/BudgetEditSheet';
import { BudgetMonthPicker } from '../src/components/budgets/BudgetMonthPicker';
import { useBudgetData } from '../src/features/budgets/useBudgetData';
import { setBudget, setBudgetsOnward } from '../src/features/budgets/repository';
import {
  BudgetScope,
  MonthKey,
  barState,
  budgetFor,
  budgetableCategories,
  computeBudgets,
  isMonthKey,
  monthKeyOf,
  suggestBudgets,
  threeMonthAverages,
} from '../src/domain/budgets';
import { formatBudgetMoney } from '../src/domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export default function BudgetScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string }>();
  const { data, refresh } = useBudgetData();
  const [month, setMonth] = useState<MonthKey>(() =>
    params.month && isMonthKey(params.month) ? params.month : monthKeyOf(Date.now())
  );
  // Defensive sync: adopt a new `month` param if one arrives while mounted.
  useEffect(() => {
    if (params.month && isMonthKey(params.month)) setMonth(params.month);
  }, [params.month]);
  const [editing, setEditing] = useState<BudgetEditTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});

  const { currency, categories, now } = data;
  const byId = useMemo(() => new Map(categories.map((x) => [x.id, x])), [categories]);

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

  const firstRun = data.loaded && data.rows.length === 0 && !firstRunDismissed;
  const suggestions = useMemo(
    () =>
      firstRun
        ? suggestBudgets({ transactions: data.transactions, categories, now, month }, currency)
        : [],
    [firstRun, data.transactions, categories, now, month, currency]
  );
  // Seed the checklist from the tick rule whenever the suggestion set changes.
  const suggestionKey = suggestions.map((s) => `${s.categoryId}:${s.amount}`).join(',');
  useEffect(() => {
    setTicks(Object.fromEntries(suggestions.map((s) => [s.categoryId, s.ticked])));
  }, [suggestionKey]);

  const averages = useMemo(
    () => threeMonthAverages({ transactions: data.transactions, categories, now, month }, currency),
    [data.transactions, categories, now, month, currency]
  );

  const openEdit = (categoryId: string) => {
    const cat = byId.get(categoryId);
    if (!cat) return;
    setEditing({
      categoryId,
      name: cat.name,
      icon: cat.icon ?? null,
      current: budgetFor(data.rows, categoryId, month),
      average: averages.get(categoryId) ?? 0,
    });
  };

  const [error, setError] = useState<string | null>(null);
  const SAVE_ERROR = "Couldn't save that budget. Please try again.";

  const onSave = async (categoryId: string, amount: number | null, scope: BudgetScope) => {
    try {
      setError(null);
      await setBudget({ categoryId, amount, month, scope });
      setEditing(null);
      await refresh();
    } catch {
      setError(SAVE_ERROR);
    }
  };

  const unbudgeted = useMemo(
    () => budgetableCategories(categories).filter((x) => budgetFor(data.rows, x.id, month) === null),
    [categories, data.rows, month]
  );

  const ticked = suggestions.filter((s) => ticks[s.categoryId]);
  const total = ticked.reduce((t, s) => t + s.amount, 0);
  const applySuggestions = async () => {
    try {
      setError(null);
      await setBudgetsOnward(
        ticked.map((s) => ({ categoryId: s.categoryId, amount: s.amount })),
        month
      );
      await refresh();
    } catch {
      setError(SAVE_ERROR);
    }
  };

  const header = (
    <View className="flex-row items-center justify-between px-5 py-3">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Pressable
          hitSlop={8}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="chevron-left" size={ICON.lg} color={c.primary} />
        </Pressable>
        <Text className="text-text text-2xl font-extrabold">Budget</Text>
      </View>
      <BudgetMonthPicker
        month={month}
        now={now || Date.now()}
        transactions={data.transactions}
        budgetRows={data.rows}
        currency={currency}
        onChange={setMonth}
      />
    </View>
  );

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 60, gap: 10 }}>
        {error && (
          <Text style={{ color: c.negative, fontSize: 13 }} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {!data.loaded ? null : firstRun ? (
          <FirstRun
            suggestions={suggestions}
            ticks={ticks}
            onToggle={(id) => setTicks((t) => ({ ...t, [id]: !t[id] }))}
            byId={byId}
            currency={currency}
            total={total}
            canUse={ticked.length > 0}
            onUse={applySuggestions}
            onSelf={() => setFirstRunDismissed(true)}
          />
        ) : (
          <>
            {summary.categories.length > 0 && (
              <View className="bg-surface border border-borderAccent rounded-lg" style={{ padding: 14 }}>
                <Text className="text-muted text-[12px] font-bold uppercase tracking-wide">
                  Left to spend
                </Text>
                <BudgetHeadline summary={summary} currency={currency} compact />
                <BudgetBar
                  budget={summary.budget}
                  spent={summary.spent}
                  scheduled={summary.scheduled}
                  state={barState(summary)}
                  tick={summary.isCurrent ? summary.tick : null}
                />
                {summary.isCurrent && summary.tick !== null ? (
                  <TodayLabel tick={summary.tick} />
                ) : (
                  <View style={{ height: 8 }} />
                )}
                <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                  <BudgetLegend summary={summary} currency={currency} />
                  {summary.isCurrent && summary.daysLeft !== null && (
                    <Text className="text-muted text-[11px]">
                      {summary.lastDay
                        ? 'Last day'
                        : `${summary.daysLeft} day${summary.daysLeft === 1 ? '' : 's'} left`}
                    </Text>
                  )}
                </View>
              </View>
            )}

            <View className="flex-row items-center justify-between px-1 pt-0.5">
              <Text className="text-muted text-[12px] font-bold uppercase tracking-wide">
                Categories
              </Text>
              <Pressable
                onPress={() => setPickerOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add a budget"
              >
                <Text style={{ color: c.primary, fontSize: 13, fontWeight: '600' }}>+ Add</Text>
              </Pressable>
            </View>

            {summary.categories.length > 0 ? (
              <View className="bg-surface border border-border rounded-md" style={{ padding: 12, gap: 12 }}>
                {summary.categories.map((v) => (
                  <BudgetCategoryRow
                    key={v.categoryId}
                    view={v}
                    category={byId.get(v.categoryId)}
                    currency={currency}
                    detail
                    okTone="text"
                    onPress={() =>
                      router.push({
                        pathname: '/budget/[categoryId]',
                        params: { categoryId: v.categoryId, month },
                      })
                    }
                  />
                ))}
              </View>
            ) : (
              <Text className="text-muted text-[13px] px-1">
                No budgets for this month yet. Tap + Add to set one.
              </Text>
            )}

            {summary.notBudgeted.length > 0 && (
              <>
                <Text className="text-muted text-[12px] font-bold uppercase tracking-wide px-1 pt-1">
                  Not budgeted
                </Text>
                <View className="bg-surface border border-border rounded-md" style={{ padding: 12, gap: 12 }}>
                  {summary.notBudgeted.map((n) => {
                    const cat = byId.get(n.categoryId);
                    return (
                      <View key={n.categoryId} className="flex-row items-center" style={{ gap: 10 }}>
                        <CategoryIcon category={cat} />
                        <View className="flex-1">
                          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                            <Text numberOfLines={1} className="text-text text-[14px] font-semibold flex-1">
                              {cat?.name ?? 'Category'}
                            </Text>
                            <Pressable
                              onPress={() => openEdit(n.categoryId)}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`Set budget for ${cat?.name ?? 'category'}`}
                            >
                              <Text style={{ color: c.primary, fontSize: 13, fontWeight: '600' }}>
                                Set budget
                              </Text>
                            </Pressable>
                          </View>
                          <Text className="text-muted text-[11px]" style={TABULAR}>
                            {formatBudgetMoney(n.amount, currency)} spent this month
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a budget">
        {unbudgeted.length === 0 ? (
          <Text className="text-muted text-center py-6">Every category already has a budget.</Text>
        ) : (
          <View style={{ gap: 4, paddingBottom: 16 }}>
            {unbudgeted.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => {
                  setPickerOpen(false);
                  openEdit(cat.id);
                }}
                className="flex-row items-center"
                style={{ gap: 10, paddingVertical: 8 }}
                accessibilityRole="button"
                accessibilityLabel={cat.name}
              >
                <CategoryIcon category={cat} />
                <Text className="text-text text-[15px] font-semibold flex-1" numberOfLines={1}>
                  {cat.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </BottomSheet>

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

function FirstRun({
  suggestions,
  ticks,
  onToggle,
  byId,
  currency,
  total,
  canUse,
  onUse,
  onSelf,
}: {
  suggestions: ReturnType<typeof suggestBudgets>;
  ticks: Record<string, boolean>;
  onToggle: (id: string) => void;
  byId: Map<string, { name: string; icon?: string | null }>;
  currency: string;
  total: number;
  canUse: boolean;
  onUse: () => void;
  onSelf: () => void;
}) {
  const c = useThemeColors();
  const hasHistory = suggestions.length > 0;
  return (
    <View style={{ gap: 10 }}>
      {hasHistory && (
        <View className="flex-row items-start" style={{ gap: 8, marginTop: 4 }}>
          <AssistantAvatar size={30} state="idle" />
          <View
            className="bg-surface border border-border flex-1"
            style={{ padding: 10, borderRadius: radius.md, borderTopLeftRadius: radius.xs }}
          >
            <Text className="text-text text-[14px]">
              Want to start from what you usually spend? These are your 3-month averages.
            </Text>
          </View>
        </View>
      )}

      {hasHistory && (
        <View className="bg-surface border border-border rounded-md" style={{ padding: 12 }}>
          <View style={{ gap: 12 }}>
            {suggestions.map((s) => {
              const cat = byId.get(s.categoryId);
              const on = !!ticks[s.categoryId];
              return (
                <Pressable
                  key={s.categoryId}
                  onPress={() => onToggle(s.categoryId)}
                  className="flex-row items-center"
                  style={{ gap: 10 }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${cat?.name ?? 'Category'} ${formatBudgetMoney(s.amount, currency)}`}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: radius.xs,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: on ? c.primaryFill : 'transparent',
                      borderWidth: on ? 0 : 1.5,
                      borderColor: c.grabHandle,
                    }}
                  >
                    {on && <Feather name="check" size={ICON.sm} color={c.onAccent} />}
                  </View>
                  <CategoryIcon category={cat} />
                  <Text
                    numberOfLines={1}
                    className={`text-[14px] font-semibold flex-1 ${on ? 'text-text' : 'text-muted'}`}
                  >
                    {cat?.name ?? 'Category'}
                  </Text>
                  <Text
                    className={`text-[15px] font-bold ${on ? 'text-text' : 'text-muted'}`}
                    style={TABULAR}
                  >
                    {formatBudgetMoney(s.amount, currency)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="bg-border my-2.5" style={{ height: 1 }} />
          <View className="flex-row items-baseline justify-between">
            <Text className="text-muted text-[13px]">Monthly total</Text>
            <Text className="text-text text-[15px] font-bold" style={TABULAR}>
              {formatBudgetMoney(total, currency)}
            </Text>
          </View>
        </View>
      )}

      {hasHistory && (
        <Button title="Use these budgets" onPress={onUse} disabled={!canUse} glow />
      )}
      <TextAction label="Set them myself" onPress={onSelf} size={14} padded={false} />
    </View>
  );
}
