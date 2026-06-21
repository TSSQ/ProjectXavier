/**
 * Transactions - dated local ledger with manual add, edit, and delete.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import { formatMoney, toMinorUnits, toMajorUnits } from '../../src/domain/money';
import { listAccounts } from '../../src/features/accounts/repository';
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../../src/features/transactions/repository';
import {
  findOrCreateByName as findOrCreateCategory,
  listCategories,
} from '../../src/features/categories/repository';
import {
  findOrCreateByName as findOrCreatePayee,
  listPayees,
} from '../../src/features/payees/repository';
import { newId } from '../../src/lib/id';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

type TxType = Transaction['type'];

const TX_TYPES: TxType[] = ['expense', 'income', 'transfer'];

interface FormState {
  editingId: string | null;
  accountId: string;
  transferAccountId: string;
  type: TxType;
  amount: string;
  date: string;
  categoryName: string;
  payeeName: string;
  note: string;
  createdAt: number | null;
  source: Transaction['source'];
}

const emptyForm = (): FormState => ({
  editingId: null,
  accountId: '',
  transferAccountId: '',
  type: 'expense',
  amount: '',
  date: formatDateInput(Date.now()),
  categoryName: '',
  payeeName: '',
  note: '',
  createdAt: null,
  source: 'manual',
});

export default function TransactionsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const payeesById = useMemo(
    () => new Map(payees.map((payee) => [payee.id, payee])),
    [payees]
  );

  const activeAccounts = accounts.filter((account) => !account.archived);
  const selectedAccount = accountsById.get(form.accountId);
  const transferChoices = activeAccounts.filter(
    (account) => account.id !== form.accountId
  );

  const refresh = useCallback(async () => {
    const [nextAccounts, nextCategories, nextPayees, nextTransactions] =
      await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
        listTransactions(),
      ]);
    setAccounts(nextAccounts);
    setCategories(nextCategories);
    setPayees(nextPayees);
    setTransactions(nextTransactions);
    setForm((current) => {
      if (current.accountId || nextAccounts.length === 0) return current;
      const firstActive =
        nextAccounts.find((account) => !account.archived) ?? nextAccounts[0]!;
      return { ...current, accountId: firstActive.id };
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const resetForm = () => {
    setForm((current) => ({
      ...emptyForm(),
      accountId: current.accountId || activeAccounts[0]?.id || '',
    }));
    setError(null);
  };

  const onEdit = (tx: Transaction) => {
    setForm({
      editingId: tx.id,
      accountId: tx.accountId,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amount: toMajorUnits(tx.amount).toFixed(2),
      date: formatDateInput(tx.occurredAt),
      categoryName: tx.categoryId
        ? categoriesById.get(tx.categoryId)?.name ?? ''
        : '',
      payeeName: tx.payeeId ? payeesById.get(tx.payeeId)?.name ?? '' : '',
      note: tx.note ?? '',
      createdAt: tx.createdAt,
      source: tx.source,
    });
    setError(null);
  };

  const onSave = async () => {
    if (busy) return;
    const account = accountsById.get(form.accountId);
    const amount = Number(form.amount);
    const occurredAt = parseDateInput(form.date);

    if (!account) {
      setError('Add an account before saving a transaction.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!occurredAt) {
      setError('Use a date like 2026-06-21.');
      return;
    }
    if (form.type === 'transfer' && !form.transferAccountId) {
      setError('Choose where the transfer goes.');
      return;
    }

    setBusy(true);
    try {
      const categoryName = form.categoryName.trim();
      const payeeName = form.payeeName.trim();
      const categoryId = categoryName
        ? await findOrCreateCategory(categoryName, form.type)
        : null;
      const payeeId = payeeName ? await findOrCreatePayee(payeeName) : null;
      const tx: Transaction = {
        id: form.editingId ?? newId(),
        accountId: account.id,
        type: form.type,
        amount: toMinorUnits(amount),
        currency: account.currency,
        categoryId,
        payeeId,
        transferAccountId:
          form.type === 'transfer' ? form.transferAccountId : null,
        note: form.note.trim() || null,
        occurredAt,
        createdAt: form.createdAt ?? Date.now(),
        source: form.source,
        receiptRef: null,
      };

      if (form.editingId) {
        await updateTransaction(tx);
      } else {
        await createTransaction(tx);
      }
      await refresh();
      resetForm();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Please try again.';
      setError(`Could not save transaction. ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (tx: Transaction) => {
    Alert.alert('Delete transaction?', 'This removes it from your local ledger.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(tx.id);
          if (form.editingId === tx.id) resetForm();
          await refresh();
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={transactions}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Transactions</Text>
            <TransactionForm
              accounts={activeAccounts}
              selectedAccount={selectedAccount}
              transferChoices={transferChoices}
              form={form}
              error={error}
              busy={busy}
              onChange={updateForm}
              onSave={onSave}
              onCancel={resetForm}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>Saved expenses will appear here.</Text>
        }
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
            accountName={accountsById.get(item.accountId)?.name ?? 'Unknown account'}
            transferAccountName={
              item.transferAccountId
                ? accountsById.get(item.transferAccountId)?.name
                : undefined
            }
            categoryName={
              item.categoryId ? categoriesById.get(item.categoryId)?.name : undefined
            }
            payeeName={item.payeeId ? payeesById.get(item.payeeId)?.name : undefined}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
          />
        )}
      />
    </View>
  );
}

function TransactionForm({
  accounts,
  selectedAccount,
  transferChoices,
  form,
  error,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  accounts: Account[];
  selectedAccount: Account | undefined;
  transferChoices: Account[];
  form: FormState;
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<FormState>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.form}>
      <View style={styles.segment}>
        {TX_TYPES.map((type) => (
          <Pressable
            key={type}
            onPress={() => onChange({ type })}
            style={[styles.segmentItem, form.type === type && styles.segmentActive]}
          >
            <Text
              style={[
                styles.segmentText,
                form.type === type && styles.segmentTextActive,
              ]}
            >
              {type}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Account</Text>
      <View style={styles.pillRow}>
        {accounts.map((account) => (
          <Pressable
            key={account.id}
            onPress={() =>
              onChange({
                accountId: account.id,
                transferAccountId:
                  account.id === form.transferAccountId ? '' : form.transferAccountId,
              })
            }
            style={[
              styles.choicePill,
              form.accountId === account.id && styles.choicePillActive,
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                form.accountId === account.id && styles.choiceTextActive,
              ]}
            >
              {account.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {form.type === 'transfer' && (
        <>
          <Text style={styles.fieldLabel}>To account</Text>
          <View style={styles.pillRow}>
            {transferChoices.map((account) => (
              <Pressable
                key={account.id}
                onPress={() => onChange({ transferAccountId: account.id })}
                style={[
                  styles.choicePill,
                  form.transferAccountId === account.id && styles.choicePillActive,
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    form.transferAccountId === account.id &&
                      styles.choiceTextActive,
                  ]}
                >
                  {account.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={styles.inputGrid}>
        <TextInput
          style={[styles.input, styles.halfInput]}
          placeholder="Amount"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={form.amount}
          onChangeText={(amount) => onChange({ amount })}
        />
        <TextInput
          style={[styles.input, styles.halfInput]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          value={form.date}
          onChangeText={(date) => onChange({ date })}
        />
      </View>
      <TextInput
        style={styles.input}
        placeholder="Payee"
        placeholderTextColor={colors.textMuted}
        value={form.payeeName}
        onChangeText={(payeeName) => onChange({ payeeName })}
      />
      <TextInput
        style={styles.input}
        placeholder="Category"
        placeholderTextColor={colors.textMuted}
        value={form.categoryName}
        onChangeText={(categoryName) => onChange({ categoryName })}
      />
      <TextInput
        style={[styles.input, styles.noteInput]}
        placeholder="Note"
        placeholderTextColor={colors.textMuted}
        value={form.note}
        onChangeText={(note) => onChange({ note })}
        multiline
      />

      <View style={styles.formFooter}>
        <Text style={styles.currencyHint}>
          {selectedAccount ? selectedAccount.currency : 'No account'}
        </Text>
        <View style={styles.actionRow}>
          {form.editingId && (
            <Pressable style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.saveButton, busy && styles.disabledButton]}
            onPress={onSave}
            disabled={busy}
          >
            <Text style={styles.saveText}>
              {form.editingId ? 'Update' : 'Add'}
            </Text>
          </Pressable>
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function TransactionRow({
  tx,
  accountName,
  transferAccountName,
  categoryName,
  payeeName,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  accountName: string;
  transferAccountName?: string;
  categoryName?: string;
  payeeName?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const signedAmount = tx.type === 'income' ? tx.amount : -tx.amount;
  const detail = [
    formatDisplayDate(tx.occurredAt),
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

  return (
    <View className="flex-row items-center gap-3 bg-surface border border-border rounded-md p-3.5 mb-2.5">
      <View className={`w-10 h-10 rounded-xl items-center justify-center ${iconBg}`}>
        <Text className="text-lg">{icon}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-text text-sm font-bold">
          {payeeName ?? sentenceCase(tx.type)}
        </Text>
        <Text className="text-muted text-xs mt-0.5">{detail.join(' · ')}</Text>
        {tx.note ? <Text className="text-muted text-xs mt-0.5">{tx.note}</Text> : null}
      </View>
      <View className="items-end" style={{ gap: 8 }}>
        <Text
          className={
            signedAmount >= 0
              ? 'text-positive text-[15px] font-bold'
              : 'text-negative text-[15px] font-bold'
          }
        >
          {formatMoney(signedAmount, tx.currency)}
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          <Pressable
            className="w-8 h-8 rounded-sm bg-surfaceAlt items-center justify-center"
            onPress={onEdit}
            accessibilityLabel="Edit transaction"
          >
            <Feather name="edit-2" color="#F2F5F9" size={16} />
          </Pressable>
          <Pressable
            className="w-8 h-8 rounded-sm bg-surfaceAlt items-center justify-center"
            onPress={onDelete}
            accessibilityLabel="Delete transaction"
          >
            <Feather name="trash-2" color="#F2637E" size={16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function parseDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function formatDateInput(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  header: { gap: spacing.md, marginBottom: spacing.md },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: {
    color: colors.textMuted,
    fontSize: typography.caption,
    textTransform: 'capitalize',
  },
  segmentTextActive: { color: '#fff', fontWeight: '600' },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choicePill: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choicePillActive: { backgroundColor: colors.primary },
  choiceText: { color: colors.textMuted, fontSize: typography.caption },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
  inputGrid: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
  },
  halfInput: { flex: 1 },
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  formFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  currencyHint: { color: colors.textMuted, fontSize: typography.caption },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  saveText: { color: '#fff', fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: { color: colors.text, fontWeight: '600' },
  disabledButton: { opacity: 0.55 },
  error: { color: colors.negative, fontSize: typography.caption },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
