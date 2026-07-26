/**
 * Ask-Xavier answer card — ranked list (docs/design/ask-xavier-queries-
 * spec.md §5.4). Feeds `top_payees` tool results — every row's amount comes
 * straight from the tool result.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { formatMoney } from '../../domain/money';
import { PayeeRow } from '../../domain/queryTools';

export function RankListCard({ rows, currency }: { rows: PayeeRow[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-muted text-sm">No spending in that period.</Text>
      </Card>
    );
  }

  return (
    <Card className="border-borderAccent self-stretch">
      {rows.map((row, i) => (
        <View
          key={row.payeeId ?? `unknown-${i}`}
          className="flex-row items-center justify-between py-1.5"
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.15)' } : undefined}
        >
          <View className="flex-row items-center flex-shrink" style={{ gap: 8 }}>
            <Text className="text-muted text-xs font-bold" style={{ width: 18 }}>
              {i + 1}
            </Text>
            <Text className="text-text text-sm flex-shrink" numberOfLines={1}>
              {row.name}
            </Text>
          </View>
          <Text className="text-text text-sm font-semibold ml-2">{formatMoney(row.amountMinor, currency)}</Text>
        </View>
      ))}
    </Card>
  );
}
