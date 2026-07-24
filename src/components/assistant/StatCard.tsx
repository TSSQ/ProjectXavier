/**
 * Ask-Xavier answer card — a single big number (docs/design/ask-xavier-
 * queries-spec.md §5.4). Feeds `total_spent`/`total_income`/`net_worth`
 * (point-value) tool results. The number is formatted straight from the
 * tool's `amountMinor` via the app's existing currency formatter — never
 * from model prose.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { formatMoney } from '../../domain/money';
import { cn } from '../ui/cn';

export function StatCard({
  label,
  amountMinor,
  currency,
  tone = 'neutral',
  detail,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  tone?: 'positive' | 'negative' | 'neutral';
  detail?: string | null;
}) {
  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-muted text-xs font-semibold">{label}</Text>
      <Text
        className={cn(
          'text-2xl font-extrabold mt-1.5',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'neutral' && 'text-text'
        )}
      >
        {formatMoney(amountMinor, currency)}
      </Text>
      {detail ? (
        <View className="mt-1.5">
          <Text className="text-muted text-[11px]">{detail}</Text>
        </View>
      ) : null}
    </Card>
  );
}
