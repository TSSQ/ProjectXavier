/**
 * The set-budget confirm card (monthly-budgets spec §6.3), in the existing
 * confirm-card pattern: "🛒 GROCERIES BUDGET" with an "October onward" info
 * chip and "$400 → $450" (the old amount struck through).
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/StatusChip';
import { MonthKey, monthName } from '../../domain/budgets';
import { formatBudgetMoney } from '../../domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function SetBudgetCard({
  icon,
  name,
  current,
  next,
  month,
  currency,
}: {
  icon: string | null;
  name: string;
  /** The budget now in force, or null when there is none. */
  current: number | null;
  next: number;
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
        {current !== null && (
          <Text className="text-muted font-semibold" style={{ textDecorationLine: 'line-through' }}>
            {formatBudgetMoney(current, currency)}
          </Text>
        )}
        {current !== null ? ' → ' : ''}
        {formatBudgetMoney(next, currency)}
      </Text>
    </Card>
  );
}
