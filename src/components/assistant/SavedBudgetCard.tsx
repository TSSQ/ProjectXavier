/**
 * The saved-expense card with its budget chip (monthly-budgets spec §6.4,
 * mockup §4): the payee and amount, the "🍔 Dining · Wallet · Today" meta
 * line, and one chip with what is left in that category's budget — coloured
 * by the category's state.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/StatusChip';
import type { SavedChip } from '../../domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function SavedBudgetCard({
  title,
  amountText,
  meta,
  chip,
}: {
  title: string;
  /** Already formatted, e.g. "−$12.50". */
  amountText: string;
  meta: string;
  chip: SavedChip;
}) {
  return (
    <Card className="self-stretch">
      <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
        <Text numberOfLines={1} className="text-text text-[14px] font-bold flex-1">
          {title}
        </Text>
        <Text className="text-negative text-[14px] font-bold" style={TABULAR}>
          {amountText}
        </Text>
      </View>
      <Text numberOfLines={1} className="text-muted text-[11px] mt-0.5">
        {meta}
      </Text>
      <View style={{ marginTop: 8 }}>
        <StatusChip label={chip.label} tone={chip.state} />
      </View>
    </Card>
  );
}
