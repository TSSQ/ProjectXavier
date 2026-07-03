/**
 * AccountFilterPills — horizontal row of filter pills for the dashboard.
 * "All accounts" pill + one pill per inline account + optional "+ N more" pill.
 */
import React from 'react';
import { ScrollView, Pressable, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Account } from '../../domain/types';
import { Selection, isAllSelected, pillsSplit } from '../../domain/accountFilter';

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
          backgroundColor: allActive ? '#5B8DEF' : '#1E2740',
        }}
        accessibilityLabel="Show all accounts"
      >
        <Text
          style={{
            fontWeight: '600',
            fontSize: 13,
            color: allActive ? '#ffffff' : '#9AA4B2',
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
              backgroundColor: active ? '#5B8DEF' : '#1E2740',
            }}
            accessibilityLabel={`Filter by ${account.name}`}
          >
            <Text
              style={{
                fontWeight: '600',
                fontSize: 13,
                color: active ? '#ffffff' : '#9AA4B2',
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
            backgroundColor: '#0E1116',
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#33406e',
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
              color: '#E2E8F0',
            }}
          >
            +{moreCount} more
          </Text>
          <Feather name="chevron-down" size={13} color="#9AA4B2" />
        </Pressable>
      )}
    </ScrollView>
  );
}
