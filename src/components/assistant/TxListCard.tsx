/**
 * Ask-Xavier answer card — a short transaction list (docs/design/ask-xavier-
 * queries-spec.md §5.4). Feeds `search_transactions` tool results. Rows are
 * intentionally simpler than the ledger's own `TransactionRow`/`FeedRecord`
 * — a query result row has already-resolved display names (categoryName/
 * payeeName/accountName), not the live `Transaction` + lookup-table shape
 * those components expect — so this renders directly from the tool result
 * rather than reconstructing a fake `Transaction` to feed them.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { formatMoney } from '../../domain/money';
import { formatDMY } from '../../domain/dates';
import { TransactionRowResult } from '../../domain/queryTools';

export function TxListCard({ rows, currency }: { rows: TransactionRowResult[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-muted text-sm">No transactions in that period.</Text>
      </Card>
    );
  }

  return (
    <Card className="border-borderAccent self-stretch">
      {rows.map((row, i) => {
        const signed = row.type === 'income' ? row.amountMinor : -row.amountMinor;
        const tone =
          row.type === 'transfer' ? 'text-muted' : signed >= 0 ? 'text-positive' : 'text-negative';
        const detail = [row.payeeName, row.categoryName, row.accountName].filter(Boolean).join(' · ');
        return (
          <View
            key={row.id}
            className="flex-row items-center justify-between py-1.5"
            style={i > 0 ? { borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.15)' } : undefined}
          >
            <View className="flex-shrink pr-2">
              <Text className="text-text text-xs font-semibold" numberOfLines={1}>
                {detail || row.note || 'Transaction'}
              </Text>
              <Text className="text-muted text-[10px] mt-0.5">{formatDMY(row.occurredAt)}</Text>
            </View>
            <Text className={`${tone} text-xs font-extrabold`}>{formatMoney(signed, currency)}</Text>
          </View>
        );
      })}
    </Card>
  );
}
