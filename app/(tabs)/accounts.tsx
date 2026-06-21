/**
 * Accounts — list accounts with live balances (grouped by assets/liabilities)
 * and add new ones (manual entry).
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import { accountBalance } from '../../src/domain/balances';
import { formatMoney, toMinorUnits } from '../../src/domain/money';
import { listAccounts, createAccount } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { ListRow } from '../../src/components/ui/ListRow';
import { SectionLabel } from '../../src/components/ui/SectionLabel';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Button } from '../../src/components/ui/Button';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [type, setType] = useState<Account['type']>('asset');

  const refresh = useCallback(async () => {
    setAccounts(await listAccounts());
    setTransactions(await listTransactions());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onAdd = async () => {
    if (!name.trim()) return;
    await createAccount({
      id: `acc_${Date.now()}`,
      name: name.trim(),
      type,
      currency: 'USD',
      openingBalance: toMinorUnits(parseFloat(opening || '0')),
    });
    setName('');
    setOpening('');
    await refresh();
  };

  const active = accounts.filter((a) => !a.archived);
  const assets = active.filter((a) => a.type === 'asset');
  const liabilities = active.filter((a) => a.type === 'liability');

  const renderRow = (a: Account) => {
    const bal = accountBalance(a, transactions);
    return (
      <ListRow
        key={a.id}
        icon={a.type === 'asset' ? '🏦' : '💳'}
        iconClassName={a.type === 'asset' ? 'bg-[#13314a]' : 'bg-[#3a2330]'}
        title={a.name}
        subtitle={`${a.subtype ?? a.type} · ${a.currency}`}
        value={formatMoney(bal, a.currency)}
        tone={bal < 0 ? 'negative' : 'positive'}
      />
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text text-[28px] font-extrabold mb-4">Accounts</Text>

        {active.length === 0 && (
          <Text className="text-muted">No accounts yet. Add one below.</Text>
        )}

        {assets.length > 0 && <SectionLabel>Assets</SectionLabel>}
        {assets.map(renderRow)}

        {liabilities.length > 0 && <SectionLabel>Liabilities</SectionLabel>}
        {liabilities.map(renderRow)}
      </ScrollView>

      <View className="bg-surface border-t border-border p-6" style={{ gap: 8 }}>
        <TextInput
          className="bg-surfaceAlt text-text rounded-sm p-3"
          placeholder="Account name"
          placeholderTextColor="#9AA4B2"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          className="bg-surfaceAlt text-text rounded-sm p-3"
          placeholder="Opening balance"
          placeholderTextColor="#9AA4B2"
          keyboardType="numeric"
          value={opening}
          onChangeText={setOpening}
        />
        <SegmentedControl
          options={['asset', 'liability'] as const}
          value={type}
          onChange={setType}
        />
        <Button title="Add account" onPress={onAdd} />
      </View>
    </View>
  );
}
