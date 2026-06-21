/**
 * Transactions - dated local ledger with manual add, edit, and delete.
 * Rows are grouped by day (Today / Yesterday / date).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  SectionList,
  Pressable,
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
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';

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

  const sections = useMemo(() => groupByDay(transactions), [transactions]);

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
    <View className="flex-1 bg-bg">
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: 24 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View className="mb-1">
            <Text className="text-text text-[28px] font-extrabold mb-4">
              Transactions
            </Text>
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
          <Text className="text-muted text-center mt-6">
            Saved expenses will appear here.
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mt-4 mb-2.5">
            {section.title}
          </Text>
        )}
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
    <Card style={{ gap: 12 }}>
      <SegmentedControl
        options={TX_TYPES}
        value={form.type}
        onChange={(type) => onChange({ type })}
      />

      <FieldLabel>Account</FieldLabel>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {accounts.map((account) => (
          <Pill
            key={account.id}
            label={account.name}
            active={form.accountId === account.id}
            onPress={() =>
              onChange({
                accountId: account.id,
                transferAccountId:
                  account.id === form.transferAccountId ? '' : form.transferAccountId,
              })
            }
          />
        ))}
      </View>

      {form.type === 'transfer' && (
        <>
          <FieldLabel>To account</FieldLabel>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {transferChoices.map((account) => (
              <Pill
                key={account.id}
                label={account.name}
                active={form.transferAccountId === account.id}
                onPress={() => onChange({ transferAccountId: account.id })}
              />
            ))}
          </View>
        </>
      )}

      <View className="flex-row" style={{ gap: 8 }}>
        <TextInput
          className="flex-1 bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
          placeholder="Amount"
          placeholderTextColor="#9AA4B2"
          keyboardType="decimal-pad"
          value={form.amount}
          onChangeText={(amount) => onChange({ amount })}
        />
        <TextInput
          className="flex-1 bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9AA4B2"
          value={form.date}
          onChangeText={(date) => onChange({ date })}
        />
      </View>
      <TextInput
        className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
        placeholder="Payee"
        placeholderTextColor="#9AA4B2"
        value={form.payeeName}
        onChangeText={(payeeName) => onChange({ payeeName })}
      />
      <TextInput
        className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
        placeholder="Category"
        placeholderTextColor="#9AA4B2"
        value={form.categoryName}
        onChangeText={(categoryName) => onChange({ categoryName })}
      />
      <TextInput
        className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
        style={{ minHeight: 72, textAlignVertical: 'top' }}
        placeholder="Note"
        placeholderTextColor="#9AA4B2"
        value={form.note}
        onChangeText={(note) => onChange({ note })}
        multiline
      />

      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="text-muted text-xs">
          {selectedAccount ? selectedAccount.currency : 'No account'}
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {form.editingId && (
            <Button
              title="Cancel"
              variant="ghost"
              onPress={onCancel}
              className="px-4 py-2"
            />
          )}
          <Button
            title={form.editingId ? 'Update' : 'Add'}
            onPress={onSave}
            loading={busy}
            className="px-5 py-2"
          />
        </View>
      </View>
      {error && <Text className="text-negative text-xs">{error}</Text>}
    </Card>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-muted text-xs font-semibold">{children}</Text>;
}

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-pill px-4 py-2 ${active ? 'bg-primary' : 'bg-surfaceAlt'}`}
    >
      <Text className={active ? 'text-white text-[13px] font-semibold' : 'text-muted text-[13px]'}>
        {label}
      </Text>
    </Pressable>
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

/** Group transactions into day buckets (newest first) for the SectionList. */
function groupByDay(
  txs: Transaction[]
): Array<{ title: string; data: Transaction[] }> {
  const sorted = [...txs].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt
  );
  const buckets = new Map<number, Transaction[]>();
  for (const tx of sorted) {
    const d = new Date(tx.occurredAt);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([key, data]) => ({ title: dayLabel(key), data }));
}

function dayLabel(ms: number): string {
  const today = new Date();
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (ms === startToday) return 'Today';
  if (ms === startToday - dayMs) return 'Yesterday';
  return formatDisplayDate(ms);
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
