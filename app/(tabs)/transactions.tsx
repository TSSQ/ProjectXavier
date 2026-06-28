/**
 * Transactions — a clean, searchable ledger grouped by day. Adding/editing is
 * done in a bottom-sheet dialog (not an always-on inline form): a floating "+"
 * (bottom-right) opens Add; tapping a row opens Edit (with delete). Search is
 * tap-to-reveal from the top bar.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { Alert, SectionList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Account, Category, Payee, Transaction, RecurrenceRule, RecurringSeries } from '../../src/domain/types';
import { toMinorUnits, toMajorUnits, formatMoney } from '../../src/domain/money';
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
  getPayeeByName,
  listPayees,
} from '../../src/features/payees/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../../src/features/settings/repository';
import { resolveCategoryId } from '../../src/domain/payees';
import { compareEdit } from '../../src/domain/parseMetrics';
import { recordEditByTxId } from '../../src/features/diagnostics/parseMetrics';
import { inRange } from '../../src/domain/period';
import {
  upcomingOccurrences,
  describeRuleShort,
  startOfUTCDay,
} from '../../src/domain/recurrence';
import {
  listSeries,
  createSeries,
  postDueOccurrences,
} from '../../src/features/recurring/repository';
import { newId } from '../../src/lib/id';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Combobox, ComboItem } from '../../src/components/ui/Combobox';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { DateField } from '../../src/components/ui/DateField';
import { PeriodSheet } from '../../src/components/ui/PeriodSheet';
import { RepeatSheet } from '../../src/components/ui/RepeatSheet';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { groupTransactionsByDay } from '../../src/lib/grouping';

type TxType = Transaction['type'];
const TX_TYPES: TxType[] = ['expense', 'income', 'transfer'];
// Only surface an upcoming recurring item once it's imminent (< 1 week away).
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface FormState {
  editingId: string | null;
  accountId: string;
  transferAccountId: string;
  type: TxType;
  amount: string;
  /** Transaction date as epoch ms (chosen via the native date picker). */
  date: number;
  categoryName: string;
  payeeName: string;
  note: string;
  createdAt: number | null;
  source: Transaction['source'];
  repeatRule: RecurrenceRule | null;
  seriesId: string | null;
  occurrenceDate: number | null;
}

const emptyForm = (accountId = ''): FormState => ({
  editingId: null,
  accountId,
  transferAccountId: '',
  type: 'expense',
  amount: '',
  date: Date.now(),
  categoryName: '',
  payeeName: '',
  note: '',
  createdAt: null,
  source: 'manual',
  repeatRule: null,
  seriesId: null,
  occurrenceDate: null,
});

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [repeatSheetOpen, setRepeatSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { sel, setSel } = usePeriod();
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const payeesById = useMemo(() => new Map(payees.map((p) => [p.id, p])), [payees]);

  const activeAccounts = accounts.filter((a) => !a.archived);
  const transferChoices = activeAccounts.filter((a) => a.id !== form.accountId);

  const periodTx = useMemo(
    () => transactions.filter((tx) => inRange(tx, { start: sel.start, end: sel.end })),
    [transactions, sel]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return periodTx;
    return periodTx.filter((tx) => {
      const hay = [
        tx.payeeId ? payeesById.get(tx.payeeId)?.name : '',
        tx.categoryId ? categoriesById.get(tx.categoryId)?.name : '',
        accountsById.get(tx.accountId)?.name ?? '',
        tx.note ?? '',
        tx.type,
        toMajorUnits(tx.amount).toFixed(2),
      ];
      return hay.some((s) => (s ?? '').toLowerCase().includes(q));
    });
  }, [periodTx, query, payeesById, categoriesById, accountsById]);

  const sections = useMemo(() => groupTransactionsByDay(filtered), [filtered]);

  // Upcoming recurring items, kept short: each active series' NEXT occurrence,
  // and only once it's imminent (less than a week away). Period-independent —
  // this is a "due soon" nudge, not a full schedule.
  const upcomingItems = useMemo(() => {
    const now = Date.now();
    const items: { key: string; series: RecurringSeries; date: number }[] = [];
    for (const s of allSeries) {
      if (s.paused || s.archived) continue;
      const [next] = upcomingOccurrences(s, now, 1);
      if (next != null && next - now < UPCOMING_WINDOW_MS) {
        items.push({ key: s.id, series: s, date: next });
      }
    }
    return items.sort((a, b) => a.date - b.date);
  }, [allSeries]);

  const categoryItems: ComboItem[] = categories
    .filter((c) => c.kind === form.type)
    .map((c) => ({ id: c.id, name: c.name }));
  const payeeItems: ComboItem[] = payees.map((p) => ({
    id: p.id,
    name: p.name,
    hint: p.defaultCategoryId
      ? categoriesById.get(p.defaultCategoryId)?.name
      : undefined,
  }));

  const refresh = useCallback(async () => {
    const [a, c, p, t, cur, s] = await Promise.all([
      listAccounts(),
      listCategories(),
      listPayees(),
      listTransactions(),
      getCurrency(),
      listSeries(),
    ]);
    setAccounts(a);
    setCategories(c);
    setPayees(p);
    setTransactions(t);
    setCurrency(cur);
    setAllSeries(s);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const updateForm = (patch: Partial<FormState>) => {
    setForm((cur) => ({ ...cur, ...patch }));
    setError(null);
  };

  const openAdd = () => {
    const first = activeAccounts[0]?.id ?? '';
    setForm(emptyForm(first));
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setForm({
      editingId: tx.id,
      accountId: tx.accountId,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amount: toMajorUnits(tx.amount).toFixed(2),
      date: tx.occurredAt,
      categoryName: tx.categoryId ? categoriesById.get(tx.categoryId)?.name ?? '' : '',
      payeeName: tx.payeeId ? payeesById.get(tx.payeeId)?.name ?? '' : '',
      note: tx.note ?? '',
      createdAt: tx.createdAt,
      source: tx.source,
      repeatRule: null,
      seriesId: tx.seriesId ?? null,
      occurrenceDate: tx.occurrenceDate ?? null,
    });
    setError(null);
    setSheetOpen(true);
  };

  const onSelectPayee = (item: ComboItem) => {
    const payee = payeesById.get(item.id);
    const patch: Partial<FormState> = { payeeName: item.name };
    if (!form.categoryName.trim() && payee?.defaultCategoryId) {
      const cat = categoriesById.get(payee.defaultCategoryId);
      if (cat) patch.categoryName = cat.name;
    }
    updateForm(patch);
  };

  const onSave = async () => {
    if (busy) return;
    const account = accountsById.get(form.accountId);
    const amount = Number(form.amount);
    const occurredAt = form.date;

    if (!account) return setError('Add an account before saving a transaction.');
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError('Enter an amount greater than zero.');
    }
    if (form.type === 'transfer' && !form.transferAccountId) {
      return setError('Choose where the transfer goes.');
    }

    setBusy(true);
    try {
      const categoryName = form.categoryName.trim();
      const payeeName = form.payeeName.trim();
      const explicitCategoryId = categoryName
        ? await findOrCreateCategory(categoryName, form.type)
        : null;

      let payeeId: string | null = null;
      let categoryId = explicitCategoryId;
      if (payeeName) {
        const existing = await getPayeeByName(payeeName);
        categoryId = resolveCategoryId(explicitCategoryId, existing);
        payeeId = existing
          ? existing.id
          : await findOrCreatePayee(payeeName, categoryId);
      }

      if (form.repeatRule && !form.editingId) {
        // Creating a new recurring series — the series drives transaction creation.
        const series: RecurringSeries = {
          id: newId(),
          rule: { ...form.repeatRule, anchor: startOfUTCDay(occurredAt) },
          template: {
            accountId: account.id,
            type: form.type,
            amount: toMinorUnits(amount),
            currency,
            categoryId,
            payeeId,
            transferAccountId:
              form.type === 'transfer' ? form.transferAccountId : null,
            note: form.note.trim() || null,
          },
          lastPostedAt: null,
          postedCount: 0,
          paused: false,
          skippedDates: [],
          createdAt: Date.now(),
          archived: false,
        };
        await createSeries(series);
        await postDueOccurrences(Date.now());
      } else {
        // Regular one-off transaction (or editing an existing transaction).
        const tx: Transaction = {
          id: form.editingId ?? newId(),
          accountId: account.id,
          type: form.type,
          amount: toMinorUnits(amount),
          currency,
          categoryId,
          payeeId,
          transferAccountId: form.type === 'transfer' ? form.transferAccountId : null,
          note: form.note.trim() || null,
          occurredAt,
          createdAt: form.createdAt ?? Date.now(),
          source: form.source,
          receiptRef: null,
          seriesId: form.seriesId ?? null,
          occurrenceDate: form.occurrenceDate ?? null,
        };

        if (form.editingId) {
          // Diagnostics: a post-save correction of an AI-parsed entry is the
          // ground-truth signal of how good the parse was. Compare the original
          // (pre-edit) values to what the user saved, linked by tx id. Content-
          // free; only fires in test builds. See parse-metrics-spec.
          const before = transactions.find((t) => t.id === form.editingId);
          await updateTransaction(tx);
          if (before && before.source === 'ai') {
            void recordEditByTxId(
              before.id,
              compareEdit(
                {
                  amount: before.amount,
                  type: before.type,
                  payeeName: before.payeeId
                    ? payeesById.get(before.payeeId)?.name ?? null
                    : null,
                  categoryName: before.categoryId
                    ? categoriesById.get(before.categoryId)?.name ?? null
                    : null,
                  occurredAt: before.occurredAt,
                },
                {
                  amount: tx.amount,
                  type: tx.type,
                  payeeName: payeeName || null,
                  categoryName: categoryName || null,
                  occurredAt: tx.occurredAt,
                }
              )
            );
          }
        } else {
          await createTransaction(tx);
        }
      }

      await refresh();
      setSheetOpen(false);
    } catch (e) {
      setError(`Could not save. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    if (!form.editingId) return;
    Alert.alert('Delete transaction?', 'This removes it from your local ledger.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(form.editingId!);
          setSheetOpen(false);
          await refresh();
        },
      },
    ]);
  };

  const formatDate = (epoch: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(epoch),
    );

  return (
    <View className="flex-1 bg-bg">
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 96 }}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="mb-1">
            <View className="flex-row items-center justify-between mb-3">
              <Pressable
                onPress={() => setPeriodSheetOpen(true)}
                className="flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2"
                accessibilityLabel="Change period"
              >
                <Feather name="calendar" size={14} color="#9AA4B2" />
                <Text className="text-text text-[13px] font-bold ml-2">{sel.label}</Text>
                <Feather name="chevron-down" size={14} color="#9AA4B2" style={{ marginLeft: 4 }} />
              </Pressable>
              {!searchOpen && (
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  className="w-9 h-9 rounded-full bg-surfaceAlt border border-border items-center justify-center"
                  accessibilityLabel="Search transactions"
                >
                  <Feather name="search" size={16} color="#9AA4B2" />
                </Pressable>
              )}
            </View>
            {searchOpen ? (
              <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-1">
                <Feather name="search" size={16} color="#9AA4B2" />
                <TextInput
                  className="flex-1 text-text px-2 py-2.5 text-base"
                  placeholder="Search payee, category, note…"
                  placeholderTextColor="#9AA4B2"
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                />
                <Pressable
                  onPress={() => {
                    setQuery('');
                    setSearchOpen(false);
                  }}
                  accessibilityLabel="Close search"
                >
                  <Feather name="x" size={18} color="#9AA4B2" />
                </Pressable>
              </View>
            ) : (
              <Text className="text-text text-[28px] font-extrabold">Transactions</Text>
            )}

            {/* Upcoming recurring occurrences */}
            {upcomingItems.length > 0 && (
              <View className="mt-4">
                <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mb-2.5">
                  Upcoming
                </Text>
                {upcomingItems.map((item) => {
                  const { series, date } = item;
                  const signed =
                    series.template.type === 'income'
                      ? series.template.amount
                      : -series.template.amount;
                  return (
                    <View
                      key={item.key}
                      className="flex-row items-center gap-3 bg-surface border border-border/50 rounded-md p-3.5 mb-2 opacity-60"
                    >
                      <View
                        className={`w-10 h-10 rounded-xl items-center justify-center ${
                          series.template.type === 'income'
                            ? 'bg-[#1c3a2e]'
                            : series.template.type === 'transfer'
                              ? 'bg-[#13314a]'
                              : 'bg-[#3a2330]'
                        }`}
                      >
                        <Text className="text-lg">🔁</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-text text-sm font-semibold">
                          {series.template.type.charAt(0).toUpperCase() +
                            series.template.type.slice(1)}
                        </Text>
                        <Text className="text-muted text-xs mt-0.5">
                          {accountsById.get(series.template.accountId)?.name ?? 'Unknown'} · {formatDate(date)}
                        </Text>
                      </View>
                      <Text
                        className={`text-[15px] font-bold ${
                          series.template.type === 'transfer'
                            ? 'text-muted'
                            : signed >= 0
                              ? 'text-positive'
                              : 'text-negative'
                        }`}
                      >
                        {formatMoney(signed, series.template.currency)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text className="text-muted text-center mt-6">
            {query ? 'No matching transactions.' : 'Tap + to add your first transaction.'}
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
              item.transferAccountId ? accountsById.get(item.transferAccountId)?.name : undefined
            }
            categoryName={
              item.categoryId
                ? `${categoriesById.get(item.categoryId)?.name ?? ''}${item.seriesId ? ' · 🔁' : ''}`
                : item.seriesId
                  ? '🔁 recurring'
                  : undefined
            }
            payeeName={item.payeeId ? payeesById.get(item.payeeId)?.name : undefined}
            onPress={() => openEdit(item)}
          />
        )}
      />

      <Pressable
        onPress={openAdd}
        className="absolute right-5 bottom-5 w-14 h-14 rounded-full bg-primary items-center justify-center"
        style={{ shadowColor: '#5B8DEF', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
        accessibilityLabel="Add transaction"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={form.editingId ? 'Edit transaction' : 'Add transaction'}
        headerRight={
          form.editingId ? (
            <Pressable
              onPress={onDelete}
              className="w-8 h-8 rounded-full bg-[#3a1f27] items-center justify-center"
              accessibilityLabel="Delete transaction"
            >
              <Feather name="trash-2" size={15} color="#f08aa0" />
            </Pressable>
          ) : null
        }
      >
        <View style={{ gap: 10 }}>
          <SegmentedControl
            options={TX_TYPES}
            value={form.type}
            onChange={(type) => updateForm({ type })}
          />

          <FieldLabel>Account</FieldLabel>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {activeAccounts.map((a) => (
              <Pill
                key={a.id}
                label={a.name}
                active={form.accountId === a.id}
                onPress={() =>
                  updateForm({
                    accountId: a.id,
                    transferAccountId:
                      a.id === form.transferAccountId ? '' : form.transferAccountId,
                  })
                }
              />
            ))}
          </View>

          {form.type === 'transfer' && (
            <>
              <FieldLabel>To account</FieldLabel>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {transferChoices.map((a) => (
                  <Pill
                    key={a.id}
                    label={a.name}
                    active={form.transferAccountId === a.id}
                    onPress={() => updateForm({ transferAccountId: a.id })}
                  />
                ))}
              </View>
            </>
          )}

          <View className="flex-row" style={{ gap: 8 }}>
            <Input
              className="flex-1 bg-surfaceAlt text-text rounded-sm px-3 text-base"
              placeholder="Amount"
              keyboardType="decimal-pad"
              value={form.amount}
              onChangeText={(amount) => updateForm({ amount })}
            />
            <DateField
              value={form.date}
              onChange={(date) => updateForm({ date })}
              accessibilityLabel="Transaction date"
            />
          </View>

          {form.type !== 'transfer' && (
            <>
              <Combobox
                placeholder="Payee"
                value={form.payeeName}
                items={payeeItems}
                onSelect={onSelectPayee}
                onCreate={(payeeName) => updateForm({ payeeName })}
              />
              <Combobox
                placeholder="Category"
                value={form.categoryName}
                items={categoryItems}
                onSelect={(item) => updateForm({ categoryName: item.name })}
                onCreate={(categoryName) => updateForm({ categoryName })}
              />
            </>
          )}

          <TextInput
            className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
            style={{ minHeight: 64, lineHeight: 20, textAlignVertical: 'top' }}
            placeholder="Note (optional)"
            placeholderTextColor="#9AA4B2"
            value={form.note}
            onChangeText={(note) => updateForm({ note })}
            multiline
          />

          {/* Repeat row — only shown when adding a new transaction */}
          {!form.editingId && (
            <Pressable
              onPress={() => setRepeatSheetOpen(true)}
              className="flex-row items-center justify-between bg-surfaceAlt rounded-sm px-3 py-2.5"
              accessibilityLabel="Set repeat schedule"
            >
              <Text className="text-muted text-base">Repeat</Text>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Text className="text-text text-[15px] font-semibold">
                  {describeRuleShort(form.repeatRule)}
                </Text>
                <Feather name="chevron-right" size={14} color="#9AA4B2" />
              </View>
            </Pressable>
          )}

          {error && <Text className="text-negative text-xs">{error}</Text>}
          <Text className="text-muted text-xs">{currency}</Text>
          <Button
            title={form.editingId ? 'Update' : form.repeatRule ? 'Save & repeat' : 'Add'}
            onPress={onSave}
            loading={busy}
          />
        </View>
      </BottomSheet>

      <PeriodSheet
        visible={periodSheetOpen}
        initialMode={sel.mode}
        transactions={transactions}
        currency={currency}
        onSelect={(next) => {
          setSel(next);
          setPeriodSheetOpen(false);
        }}
        onClose={() => setPeriodSheetOpen(false)}
      />

      <RepeatSheet
        visible={repeatSheetOpen}
        anchor={form.date}
        initialRule={form.repeatRule}
        onSelect={(rule) => updateForm({ repeatRule: rule })}
        onClose={() => setRepeatSheetOpen(false)}
      />
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-muted text-xs font-semibold">{children}</Text>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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
