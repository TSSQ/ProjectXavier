/**
 * Transactions — a clean, searchable ledger grouped by day. Adding/editing is
 * done in TransactionFormSheet (bottom-sheet dialog): a floating "+" opens Add;
 * tapping a row opens Edit (with delete). Search is tap-to-reveal from the top
 * bar. Period filtering is done via PeriodSheet.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { Alert, SectionList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Account, Category, Payee, Transaction, RecurringSeries } from '../../src/domain/types';
import { toMajorUnits, formatMoney } from '../../src/domain/money';
import { useThemeColors } from '../../src/theme/useThemeColors';
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
import { upcomingOccurrences, startOfUTCDay } from '../../src/domain/recurrence';
import {
  listSeries,
  createSeries,
  postDueOccurrences,
} from '../../src/features/recurring/repository';
import { newId } from '../../src/lib/id';
import { PeriodSheet } from '../../src/components/ui/PeriodSheet';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { groupTransactionsByDay } from '../../src/lib/grouping';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';

// Only surface an upcoming recurring item once it's imminent (< 1 week away).
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Screen-specific metadata needed by onSave that doesn't live in FormValues.
 */
interface SheetMeta {
  editingId: string | null;
  createdAt: number | null;
  source: Transaction['source'];
}

const emptyMeta = (): SheetMeta => ({
  editingId: null,
  createdAt: null,
  source: 'manual',
});

const emptyInitial = (accountId = ''): FormValues => ({
  accountId,
  transferAccountId: '',
  type: 'expense',
  amountMinor: 0,
  date: Date.now(),
  categoryName: '',
  payeeName: '',
  note: '',
  repeatRule: null,
  seriesId: null,
  occurrenceDate: null,
  pending: false,
});

export default function TransactionsScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [initial, setInitial] = useState<FormValues>(emptyInitial);
  /** Screen-specific fields the form component doesn't need to know about. */
  const [meta, setMeta] = useState<SheetMeta>(emptyMeta);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { sel, setSel } = usePeriod();
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Derived maps ──────────────────────────────────────────────────────────
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

  // ── Data refresh ──────────────────────────────────────────────────────────
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

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // ── Sheet open helpers ────────────────────────────────────────────────────
  const openAdd = () => {
    const first = activeAccounts[0]?.id ?? '';
    setInitial(emptyInitial(first));
    setMeta(emptyMeta());
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setInitial({
      accountId: tx.accountId,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amountMinor: tx.amount,          // already integer minor units
      date: tx.occurredAt,
      categoryName: tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '',
      payeeName: tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '',
      note: tx.note ?? '',
      repeatRule: null,
      seriesId: tx.seriesId ?? null,
      occurrenceDate: tx.occurrenceDate ?? null,
      pending: tx.pending,
    });
    setMeta({
      editingId: tx.id,
      createdAt: tx.createdAt,
      source: tx.source,
    });
    setError(null);
    setSheetOpen(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const onSave = async (values: FormValues) => {
    if (busy) return;

    const account = accountsById.get(values.accountId);
    const occurredAt = values.date;

    if (!account) {
      setError('Add an account before saving a transaction.');
      return;
    }
    if (values.type === 'transfer' && !values.transferAccountId) {
      setError('Choose where the transfer goes.');
      return;
    }

    setBusy(true);
    try {
      const categoryName = values.categoryName.trim();
      const payeeName = values.payeeName.trim();
      const explicitCategoryId = categoryName
        ? await findOrCreateCategory(categoryName, values.type)
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

      if (values.repeatRule && !meta.editingId) {
        // Creating a new recurring series.
        const series: RecurringSeries = {
          id: newId(),
          rule: { ...values.repeatRule, anchor: startOfUTCDay(occurredAt) },
          template: {
            accountId: account.id,
            type: values.type,
            amount: values.amountMinor,      // already minor units
            currency,
            categoryId,
            payeeId,
            transferAccountId:
              values.type === 'transfer' ? values.transferAccountId : null,
            note: values.note.trim() || null,
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
        const tx: Transaction = {
          id: meta.editingId ?? newId(),
          accountId: account.id,
          type: values.type,
          amount: values.amountMinor,        // already minor units
          currency,
          categoryId,
          payeeId,
          transferAccountId: values.type === 'transfer' ? values.transferAccountId : null,
          note: values.note.trim() || null,
          occurredAt,
          createdAt: meta.createdAt ?? Date.now(),
          source: meta.source,
          receiptRef: null,
          seriesId: values.seriesId ?? null,
          occurrenceDate: values.occurrenceDate ?? null,
          pending: values.pending,
        };

        if (meta.editingId) {
          // Diagnostics: compare pre-edit AI parse to post-edit values.
          const before = transactions.find((t) => t.id === meta.editingId);
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

  // ── Delete ────────────────────────────────────────────────────────────────
  const onDelete = () => {
    if (!meta.editingId) return;
    Alert.alert('Delete transaction?', 'This removes it from your local ledger.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(meta.editingId!);
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

  // ── Render ────────────────────────────────────────────────────────────────
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
                <Feather name="calendar" size={14} color={c.muted} />
                <Text className="text-text text-[13px] font-bold ml-2">{sel.label}</Text>
                <Feather name="chevron-down" size={14} color={c.muted} style={{ marginLeft: 4 }} />
              </Pressable>
              {!searchOpen && (
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  className="w-9 h-9 rounded-full bg-surfaceAlt border border-border items-center justify-center"
                  accessibilityLabel="Search transactions"
                >
                  <Feather name="search" size={16} color={c.muted} />
                </Pressable>
              )}
            </View>
            {searchOpen ? (
              <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-1">
                <Feather name="search" size={16} color={c.muted} />
                <TextInput
                  className="flex-1 text-text px-2 py-2.5 text-base"
                  placeholder="Search payee, category, note…"
                  placeholderTextColor={c.muted}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                />
                <Pressable
                  onPress={() => { setQuery(''); setSearchOpen(false); }}
                  accessibilityLabel="Close search"
                >
                  <Feather name="x" size={18} color={c.muted} />
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
                            ? 'bg-chipIncome'
                            : series.template.type === 'transfer'
                              ? 'bg-chipTransfer'
                              : 'bg-chipExpense'
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

      {/* FAB */}
      <Pressable
        onPress={openAdd}
        className="absolute right-5 bottom-5 w-14 h-14 rounded-full bg-primary items-center justify-center"
        style={{ shadowColor: c.primary, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
        accessibilityLabel="Add transaction"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>

      {/* Shared transaction form sheet */}
      <TransactionFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={meta.editingId ? 'Edit transaction' : 'Add transaction'}
        mode={meta.editingId ? 'edit' : 'add'}
        accounts={accounts}
        categories={categories}
        payees={payees}
        currency={currency}
        showRepeat
        initial={initial}
        onSave={onSave}
        onDelete={meta.editingId ? onDelete : undefined}
        busy={busy}
        error={error}
      />

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
    </View>
  );
}
