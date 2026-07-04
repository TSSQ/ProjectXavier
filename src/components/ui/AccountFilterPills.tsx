/**
 * AccountFilterPills — horizontal row of filter pills for the dashboard.
 * "All accounts" pill + one pill per inline account + optional "+ N more" pill.
 */
import React from 'react';
import { ScrollView, Pressable, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Account } from '../../domain/types';
import { Selection, isAllSelected, pillsSplit } from '../../domain/accountFilter';
import { useThemeColors } from '../../theme/useThemeColors';

const DEFAULT_CAP = 3;

export function AccountFilterPills({
  accounts,
  selection,
  onToggleAccount,
  onSelectAll,
  onOpenPicker,
  cap = DEFAULT_CAP,
}: {
  accounts: Account[];
  selection: Selection;
  onToggleAccount: (id: string) => void;
  onSelectAll: () => void;
  onOpenPicker: () => void;
  cap?: number;
}) {
  const c = useThemeColors();
  const { inline, moreCount } = pillsSplit(accounts, selection, cap);
  const allActive = isAllSelected(selection);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingBottom: 14 }}
    >
      {/* "All accounts" pill */}
      <Pressable
        onPress={onSelectAll}
        style={{
          paddingHorizontal: 15,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: allActive ? c.primary : c.surfaceBlue,
        }}
        accessibilityLabel="Show all accounts"
      >
        <Text
          style={{
            fontWeight: '600',
            fontSize: 13,
            color: allActive ? c.onAccent : c.muted,
          }}
        >
          All accounts
        </Text>
      </Pressable>

      {/* Inline account pills */}
      {inline.map((account) => {
        const active = !allActive;
        return (
          <Pressable
            key={account.id}
            onPress={() => onToggleAccount(account.id)}
            style={{
              paddingHorizontal: 15,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: active ? c.primary : c.surfaceBlue,
            }}
            accessibilityLabel={`Filter by ${account.name}`}
          >
            <Text
              style={{
                fontWeight: '600',
                fontSize: 13,
                color: active ? c.onAccent : c.muted,
              }}
            >
              {account.name}
            </Text>
          </Pressable>
        );
      })}

      {/* "+ N more" pill */}
      {moreCount > 0 && (
        <Pressable
          onPress={onOpenPicker}
          style={{
            paddingHorizontal: 15,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: c.bg,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: c.borderAccent,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
          accessibilityLabel={`Show ${moreCount} more accounts`}
        >
          <Text
            style={{
              fontWeight: '600',
              fontSize: 13,
              color: c.text,
            }}
          >
            +{moreCount} more
          </Text>
          <Feather name="chevron-down" size={13} color={c.muted} />
        </Pressable>
      )}
    </ScrollView>
  );
}
