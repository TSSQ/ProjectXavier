/**
 * Accounts — list accounts with live balances and add new ones (manual entry).
 */
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Account } from '../../src/domain/types';
import { accountBalance } from '../../src/domain/balances';
import { formatMoney, toMinorUnits } from '../../src/domain/money';
import { listAccounts, createAccount } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { colors, spacing, radius, typography } from '../../src/theme/tokens';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Awaited<ReturnType<typeof listTransactions>>>([]);
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

  return (
    <View style={styles.screen}>
      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: spacing.lg }}
        ListHeaderComponent={<Text style={styles.title}>Accounts</Text>}
        ListEmptyComponent={<Text style={styles.empty}>No accounts yet. Add one below.</Text>}
        renderItem={({ item }) => (
          <View style={styles.accountRow}>
            <View>
              <Text style={styles.accountName}>{item.name}</Text>
              <Text style={styles.accountType}>{item.type}</Text>
            </View>
            <Text style={styles.balance}>
              {formatMoney(accountBalance(item, transactions), item.currency)}
            </Text>
          </View>
        )}
      />

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Account name"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Opening balance"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          value={opening}
          onChangeText={setOpening}
        />
        <View style={styles.typeRow}>
          {(['asset', 'liability'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={[styles.typePill, type === t && styles.typePillActive]}
            >
              <Text style={[styles.typeText, type === t && styles.typeTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.addButton} onPress={onAdd}>
          <Text style={styles.addText}>Add account</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: typography.title, fontWeight: '700', marginBottom: spacing.md },
  empty: { color: colors.textMuted },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  accountName: { color: colors.text, fontSize: typography.body, fontWeight: '600' },
  accountType: { color: colors.textMuted, fontSize: typography.caption, textTransform: 'capitalize' },
  balance: { color: colors.text, fontSize: typography.body, fontWeight: '600' },
  form: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  typePill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  typePillActive: { backgroundColor: colors.primary },
  typeText: { color: colors.textMuted, textTransform: 'capitalize' },
  typeTextActive: { color: '#fff', fontWeight: '600' },
  addButton: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  addText: { color: '#fff', fontWeight: '600', fontSize: typography.body },
});
