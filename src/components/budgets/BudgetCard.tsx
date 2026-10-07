/**
 * The dashboard's budget card (monthly-budgets spec §5.1, mockup option A):
 * what is left, whether the month is on pace, and the three categories that
 * need a look. Rendered only for a single-month period (the caller decides,
 * via `budgetCardKind`). Past and future months show the same card without the
 * tick, chip or per-day figure. A month with no budgets shows a compact variant
 * instead: `BudgetSetupCard` for the current month, `BudgetEmptyCard` (opens
 * that month's Budget screen) for any other.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { BudgetBar, TodayLabel, LegendSwatch } from '../ui/BudgetBar';
import { StatusChip } from '../ui/StatusChip';
import { Button } from '../ui/Button';
import { BudgetCategoryRow } from './BudgetCategoryRow';
import { useThemeColors } from '../../theme/useThemeColors';
import type { Category } from '../../domain/types';
import { BudgetSummary, MonthKey, dashboardRows, monthName, barState } from '../../domain/budgets';
import { emptyBudgetCardCopy, formatBudgetMoney, formatBudgetWhole, legendText, moreLine } from '../../domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

/** The headline: "$663 left of $2,100", or "$250 over" past the cap. */
export function BudgetHeadline({
  summary,
  currency,
  compact = false,
}: {
  summary: BudgetSummary;
  currency: string;
  /** "$663 of $2,100" (under a "Left to spend" label) instead of "$663 left of $2,100". */
  compact?: boolean;
}) {
  const c = useThemeColors();
  const over = summary.left < 0;
  return (
    <View className="flex-row items-baseline flex-wrap" style={{ gap: 6 }}>
      <Text
        style={{
          ...TABULAR,
          color: over ? c.negative : c.text,
          fontSize: 28,
          fontWeight: '800',
          letterSpacing: -0.3,
        }}
      >
        {formatBudgetMoney(Math.abs(summary.left), currency)}
        {over ? ' over' : ''}
      </Text>
      <Text className="text-muted text-[13px]" style={TABULAR}>
        {over || compact ? 'of' : 'left of'} {formatBudgetMoney(summary.budget, currency)}
      </Text>
    </View>
  );
}

/** "Spent $1,287 · Scheduled $150", each with its swatch. */
export function BudgetLegend({
  summary,
  currency,
  spentLabel = 'Spent',
}: {
  summary: Pick<BudgetSummary, 'spent' | 'scheduled'>;
  currency: string;
  spentLabel?: string;
}) {
  const legend = legendText(summary.spent, summary.scheduled, currency, spentLabel);
  return (
    <View className="flex-row items-center flex-wrap" style={{ gap: 12 }}>
      <View className="flex-row items-center">
        <LegendSwatch />
        <Text className="text-muted text-[11px]" style={TABULAR}>{legend.spent}</Text>
      </View>
      {legend.scheduled && (
        <View className="flex-row items-center">
          <LegendSwatch hatched />
          <Text className="text-muted text-[11px]" style={TABULAR}>{legend.scheduled}</Text>
        </View>
      )}
    </View>
  );
}

export function BudgetCard({
  summary,
  categories,
  currency,
  accountFilterActive,
  onOpenAll,
}: {
  summary: BudgetSummary;
  categories: Category[];
  currency: string;
  /** An account filter is on: the card ignores it, and says so. */
  accountFilterActive: boolean;
  onOpenAll: () => void;
}) {
  const c = useThemeColors();
  const byId = new Map(categories.map((x) => [x.id, x]));
  const { rows, moreCount, moreAllOk } = dashboardRows(summary);
  const showPace = summary.isCurrent;

  return (
    <View
      className="bg-surface border border-borderAccent rounded-lg mb-3"
      style={{ padding: 14 }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-muted text-[12px] font-bold uppercase tracking-wide">
          Budget · {monthName(summary.month)}
        </Text>
        <Pressable onPress={onOpenAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="All budgets">
          <Text style={{ color: c.primary, fontSize: 13, fontWeight: '600' }}>All budgets ›</Text>
        </Pressable>
      </View>
      {accountFilterActive && <Text className="text-muted text-[11px] mt-0.5">All accounts</Text>}

      <View className="mt-1">
        <BudgetHeadline summary={summary} currency={currency} />
      </View>

      <BudgetBar
        budget={summary.budget}
        spent={summary.spent}
        scheduled={summary.scheduled}
        state={barState(summary)}
        tick={showPace ? summary.tick : null}
      />
      {showPace && summary.tick !== null ? <TodayLabel tick={summary.tick} /> : <View style={{ height: 8 }} />}
      <View className="mb-1.5">
        <BudgetLegend summary={summary} currency={currency} />
      </View>

      {showPace && summary.chip && summary.chipState && (
        <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
          <StatusChip label={summary.chip} tone={summary.chipState} />
          {summary.lastDay ? (
            <Text className="text-muted text-[13px]">Last day</Text>
          ) : (
            <Text className="text-muted text-[13px]">
              {summary.daysLeft} day{summary.daysLeft === 1 ? '' : 's'} left
              {summary.perDay !== null && (
                <>
                  {' · about '}
                  <Text style={{ ...TABULAR, color: c.text, fontWeight: '700' }}>
                    {formatBudgetWhole(summary.perDay, currency)}/day
                  </Text>
                </>
              )}
            </Text>
          )}
        </View>
      )}

      <View className="bg-border my-2" style={{ height: 1 }} />

      <View style={{ gap: 9 }}>
        {rows.map((v) => (
          <BudgetCategoryRow
            key={v.categoryId}
            view={v}
            category={byId.get(v.categoryId)}
            currency={currency}
          />
        ))}
      </View>
      {moreCount > 0 && (
        <Text className="text-muted text-[11px] mt-2">{moreLine(moreCount, moreAllOk)}</Text>
      )}
    </View>
  );
}

/** Shown on the current month when no category has a budget yet. */
export function BudgetSetupCard({ onSetup }: { onSetup: () => void }) {
  return (
    <View
      className="bg-surface border border-borderAccent rounded-lg mb-3"
      style={{ padding: 14, gap: 10 }}
    >
      <Text className="text-text text-[15px] font-semibold">Set a monthly budget per category</Text>
      <Button title="Set up budgets" onPress={onSetup} accessibilityLabel="Set up budgets" />
    </View>
  );
}

/** Shown on a past or future month with no budgets: says so, opens that month's Budget screen. */
export function BudgetEmptyCard({
  month,
  now,
  onOpen,
}: {
  month: MonthKey;
  now: number;
  onOpen: () => void;
}) {
  const c = useThemeColors();
  const copy = emptyBudgetCardCopy(month, now);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={copy.accessibilityLabel}
      className="bg-surface border border-borderAccent rounded-lg mb-3 active:opacity-70"
      style={{ padding: 14 }}
    >
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="text-text text-[15px] font-semibold flex-1">{copy.title}</Text>
        <Text style={{ color: c.primary, fontSize: 13, fontWeight: '600' }}>Budget ›</Text>
      </View>
      <Text className="text-muted text-[13px] mt-1">{copy.hint}</Text>
    </Pressable>
  );
}
