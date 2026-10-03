/**
 * The remove-budget confirm card (monthly-budgets spec, chat amendment), in the
 * set-budget card's pattern: "🍔 FOOD BUDGET" with an "October onward" chip and
 * the old amount struck through, ending in "No budget".
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/StatusChip';
import { MonthKey, monthName } from '../../domain/budgets';
import { formatBudgetMoney } from '../../domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function RemoveBudgetCard({
  icon,
  name,
  current,
  month,
  currency,
}: {
  icon: string | null;
  name: string;
  /** The budget being removed. */
  current: number;
  month: MonthKey;
  currency: string;
}) {
  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text numberOfLines={1} className="text-muted text-[12px] font-bold uppercase tracking-wide flex-1">
          {icon ?? '🏷️'} {name} budget
        </Text>
        <StatusChip label={`${monthName(month)} onward`} tone="info" />
      </View>
      <Text className="text-text text-[16px] font-extrabold mt-1" style={TABULAR}>
        <Text className="text-muted font-semibold" style={{ textDecorationLine: 'line-through' }}>
          {formatBudgetMoney(current, currency)}
        </Text>
        {' → No budget'}
      </Text>
    </Card>
  );
}
