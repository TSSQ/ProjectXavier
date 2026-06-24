import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Transaction } from '../../domain/types';
import { formatMoney } from '../../domain/money';

/**
 * Presentational ledger row. Used by the transactions screen (with edit/delete
 * actions) and the account-details screen (read-only). Pass `signedAmount` to
 * override the default sign (needed for transfers on a per-account view); omit
 * `accountName` to drop it from the meta line.
 */
export function TransactionRow({
  tx,
  accountName,
  transferAccountName,
  categoryName,
  payeeName,
  signedAmount,
  onPress,
  onLongPress,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  accountName?: string;
  transferAccountName?: string;
  categoryName?: string;
  payeeName?: string;
  signedAmount?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const signed =
    signedAmount ?? (tx.type === 'income' ? tx.amount : -tx.amount);
  const detail = [
    accountName,
    tx.type === 'transfer' && transferAccountName
      ? `to ${transferAccountName}`
      : null,
    categoryName,
  ].filter(Boolean);
  const icon = tx.type === 'income' ? '💰' : tx.type === 'transfer' ? '🔁' : '🧾';
  const iconBg =
    tx.type === 'income'
      ? 'bg-[#1c3a2e]'
      : tx.type === 'transfer'
        ? 'bg-[#13314a]'
        : 'bg-[#3a2330]';
  const hasActions = !!(onEdit || onDelete);

  const body = (
    <>
      <View className={`w-10 h-10 rounded-xl items-center justify-center ${iconBg}`}>
        <Text className="text-lg">{icon}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-text text-sm font-bold">
          {payeeName ?? sentenceCase(tx.type)}
        </Text>
        {detail.length > 0 ? (
          <Text className="text-muted text-xs mt-0.5">{detail.join(' · ')}</Text>
        ) : null}
        {tx.note ? <Text className="text-muted text-xs mt-0.5">{tx.note}</Text> : null}
      </View>
      <View className="items-end" style={{ gap: 8 }}>
        <Text
          className={
            // Transfers move money between your own accounts, so they're
            // net-worth-neutral — shown in muted grey, not red/green.
            tx.type === 'transfer'
              ? 'text-muted text-[15px] font-bold'
              : signed >= 0
                ? 'text-positive text-[15px] font-bold'
                : 'text-negative text-[15px] font-bold'
          }
        >
          {formatMoney(signed, tx.currency)}
        </Text>
        {hasActions ? (
          <View className="flex-row" style={{ gap: 8 }}>
            {onEdit ? (
              <Pressable
                className="w-8 h-8 rounded-sm bg-surfaceAlt items-center justify-center"
                onPress={onEdit}
                accessibilityLabel="Edit transaction"
              >
                <Feather name="edit-2" color="#F2F5F9" size={16} />
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable
                className="w-8 h-8 rounded-sm bg-surfaceAlt items-center justify-center"
                onPress={onDelete}
                accessibilityLabel="Delete transaction"
              >
                <Feather name="trash-2" color="#F2637E" size={16} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );

  const className =
    'flex-row items-center gap-3 bg-surface border border-border rounded-md p-3.5 mb-2.5';

  return (onPress || onLongPress) ? (
    <Pressable className={className} onPress={onPress} onLongPress={onLongPress}>
      {body}
    </Pressable>
  ) : (
    <View className={className}>{body}</View>
  );
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
