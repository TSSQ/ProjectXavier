/**
 * Compact transaction record for the assistant feed — a smaller, alignable
 * cousin of TransactionRow. AI-logged entries render on the LEFT (the
 * assistant's reply); manually-added entries render on the RIGHT with a
 * "manual" tag (they read as something the user did). Net-worth-neutral
 * transfers show their amount in muted grey, matching the ledger.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Transaction } from '../../domain/types';
import { formatMoney } from '../../domain/money';
import { cn } from './cn';

export function FeedRecord({
  tx,
  accountName,
  categoryName,
  payeeName,
  align,
  showManualTag = false,
}: {
  tx: Transaction;
  accountName?: string;
  categoryName?: string;
  payeeName?: string;
  align: 'left' | 'right';
  showManualTag?: boolean;
}) {
  const signed = tx.type === 'income' ? tx.amount : -tx.amount;
  const icon = tx.type === 'income' ? '💰' : tx.type === 'transfer' ? '🔁' : '🧾';
  const iconBg =
    tx.type === 'income'
      ? 'bg-chipIncome'
      : tx.type === 'transfer'
        ? 'bg-chipTransfer'
        : 'bg-chipExpense';
  const detail = [accountName, categoryName].filter(Boolean).join(' · ');
  const amountTone =
    tx.type === 'transfer'
      ? 'text-muted'
      : signed >= 0
        ? 'text-positive'
        : 'text-negative';

  return (
    <View
      className={cn(
        'flex-row items-center gap-2 rounded-[13px] px-2.5 py-2 max-w-[82%]',
        align === 'left'
          ? 'self-start bg-surface border border-border rounded-bl-md'
          : 'self-end bg-[#172033] border border-[#2c3a59] rounded-br-md'
      )}
    >
      <View className={`w-7 h-7 rounded-lg items-center justify-center ${iconBg}`}>
        <Text className="text-sm">{icon}</Text>
      </View>
      <View className="flex-shrink">
        <View className="flex-row items-center">
          <Text className="text-text text-[12px] font-bold" numberOfLines={1}>
            {payeeName ?? sentenceCase(tx.type)}
          </Text>
          {showManualTag ? (
            <Text className="text-[8px] font-bold text-[#8aa0c8] border border-[#2c3a59] rounded-pill px-1.5 py-0.5 ml-1.5 uppercase">
              manual
            </Text>
          ) : null}
        </View>
        {detail ? <Text className="text-muted text-[9px] mt-0.5">{detail}</Text> : null}
      </View>
      <Text className={`${amountTone} text-[12px] font-extrabold ml-auto pl-2`}>
        {formatMoney(signed, tx.currency)}
      </Text>
    </View>
  );
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
