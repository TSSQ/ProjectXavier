/**
 * AccountFilterPills — horizontal row of filter pills for the dashboard.
 * "All accounts" pill + one pill per inline account + optional "+ N more" pill.
 *
 * All three pill kinds are `Chip surface="canvas"` (glass-standard-adoption-
 * spec.md S3) — the "All accounts" pill is `selected={allActive}`, each
 * account pill `selected={!allActive}` (unchanged semantics), and "+N more"
 * is `overflow` with a trailing chevron.
 */
import React from 'react';
import { ScrollView } from 'react-native';
import { Account } from '../../domain/types';
import { Selection, isAllSelected, pillsSplit } from '../../domain/accountFilter';
import { Chip } from './Chip';

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
      <Chip
        label="All accounts"
        selected={allActive}
        onPress={onSelectAll}
        surface="canvas"
        accessibilityLabel="Show all accounts"
      />

      {/* Inline account pills */}
      {inline.map((account) => (
        <Chip
          key={account.id}
          label={`${account.name}${account.archived ? ' · Archived' : ''}`}
          selected={!allActive}
          onPress={() => onToggleAccount(account.id)}
          surface="canvas"
          accessibilityLabel={`Filter by ${account.name}`}
        />
      ))}

      {/* "+ N more" pill */}
      {moreCount > 0 && (
        <Chip
          label={`+${moreCount} more`}
          onPress={onOpenPicker}
          surface="canvas"
          overflow
          trailing="chevron-down"
          accessibilityLabel={`Show ${moreCount} more accounts`}
        />
      )}
    </ScrollView>
  );
}
