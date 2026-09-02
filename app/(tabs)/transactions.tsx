/**
 * Transactions — a clean, searchable ledger grouped by day. Adding/editing is
 * done in TransactionFormSheet (bottom-sheet dialog): a floating "+" opens Add;
 * tapping a row opens Edit (with delete). Search is tap-to-reveal from the top
 * bar. Period filtering is done via PeriodSheet.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { useIncludeArchived } from '../../src/context/useIncludeArchived';
import {
  Alert,
  SectionList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Account, Category, Payee, Transaction, RecurringSeries } from '../../src/domain/types';
import { toMajorUnits, formatMoney } from '../../src/domain/money';
import { currencyExponent } from '../../src/domain/currency';
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
import { sectionNetAll } from '../../src/domain/balances';
import { inRange } from '../../src/domain/period';
import {
  hasArchivedAccounts,
  accountsInScope,
  isTransactionVisible,
} from '../../src/domain/accountArchive';
import {
  upcomingOccurrences,
  buildRecurringSeries,
  backfillOccurrences,
  seriesTitle,
} from '../../src/domain/recurrence';
import {
  listSeries,
  createSeries,
  postDueOccurrences,
} from '../../src/features/recurring/repository';
import { newId } from '../../src/lib/id';
import { buildCopyInitial, copyLabelFor } from '../../src/domain/transactionCopy';
import { PeriodSheet } from '../../src/components/ui/PeriodSheet';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { SwipeAction } from '../../src/components/ui/SwipeableRow';
import { IncludeArchivedToggle } from '../../src/components/ui/IncludeArchivedToggle';
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
  mode: 'add' | 'edit' | 'copy';
  editingId: string | null;
  createdAt: number | null;
  source: Transaction['source'];
  /** Banner text shown in copy mode. */
  copyLabel: string;
}

const emptyMeta = (): SheetMeta => ({
  mode: 'add',
  editingId: null,
  createdAt: null,
  source: 'manual',
  copyLabel: '',
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
  const [includeArchived, setIncludeArchived] = useIncludeArchived();
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Swipe-reveal (Copy | Delete) ─────────────────────────────────────────
  // Single-open state lives here, not in any row — see SwipeableRow.tsx.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // While a horizontal drag is in progress, the SectionList must not also
  // scroll (spec §4.7).
  const [swiping, setSwiping] = useState(false);

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

  // Shared with the dashboard via useIncludeArchived (spec §5.3a) — same
  // scope, same toggle, so "archived" means one thing on both screens.
  const visibleAccountIds = useMemo(
    () => new Set(accountsInScope(accounts, includeArchived).map((a) => a.id)),
    [accounts, includeArchived]
  );

  // §8.6 (mirrors the dashboard's own reset): once nothing is archived,
  // don't let an on-toggle silently resurrect itself the next time something
  // is archived again — this screen has no render gate of its own, but it
  // shares the toggle, so it must join in resetting it.
  useEffect(() => {
    if (includeArchived && !hasArchivedAccounts(accounts)) {
      setIncludeArchived(false);
    }
  }, [accounts, includeArchived, setIncludeArchived]);

  const periodTx = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          inRange(tx, { start: sel.start, end: sel.end }) &&
          isTransactionVisible(tx, visibleAccountIds)
      ),
    [transactions, sel, visibleAccountIds]
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
        toMajorUnits(tx.amount, tx.currency).toFixed(currencyExponent(tx.currency)),
      ];
      return hay.some((s) => (s ?? '').toLowerCase().includes(q));
    });
  }, [periodTx, query, payeesById, categoriesById, accountsById]);

  // Passing the clock collects future-dated rows into one leading "Upcoming"
  // section instead of scattering them across day headings above today, where
  // a scheduled charge reads as something that already happened.
  const sections = useMemo(() => groupTransactionsByDay(filtered, Date.now()), [filtered]);

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
    // A refresh must not strand a swiped-open row whose transaction is now
    // gone (e.g. deleted from elsewhere) — reconcile by id (spec §4.7/§8.3).
    setOpenRowId((id) => (id && t.some((tx) => tx.id === id) ? id : null));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Swiping a row open, then changing the search query, would otherwise leave
  // a row revealed under a now-different result set (spec §8.6).
  useEffect(() => { setOpenRowId(null); }, [query]);

  // ── Sheet open helpers ────────────────────────────────────────────────────
  // Every sheet-open helper below also clears openRowId — opening a sheet
  // over the list must not leave a swiped-open row stranded underneath it
  // (spec §4.7 "sheets/menus close it").
  const openAdd = () => {
    const first = activeAccounts[0]?.id ?? '';
    setInitial(emptyInitial(first));
    setMeta(emptyMeta());
    setError(null);
    setOpenRowId(null);
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
      mode: 'edit',
      editingId: tx.id,
      createdAt: tx.createdAt,
      source: tx.source,
      copyLabel: '',
    });
    setError(null);
    setOpenRowId(null);
    setSheetOpen(true);
  };

  /** Pre-fill the form from an existing transaction and open as a duplicate.
   *  accountId comes from the transaction itself (not any "current screen"
   *  account) — this tab spans multiple accounts. */
  const openCopy = (tx: Transaction) => {
    const names = {
      payeeName: tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '',
      categoryName: tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '',
    };
    setInitial(buildCopyInitial(tx, { ...names, now: Date.now() }));
    setMeta({
      mode: 'copy',
      editingId: null,
      createdAt: null,
      source: 'manual',
      copyLabel: copyLabelFor(tx, names),
    });
    setError(null);
    setOpenRowId(null);
    setSheetOpen(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  /**
   * A back-dated repeating transaction is ambiguous and the app must not guess:
   * creating the months since silently is how one entry became thirteen rows,
   * and creating none silently hides charges the user believes are recorded.
   * So ask, once, only when there is actually something to ask about.
   *
   * Resolves true to create them. Cancelling the dialog resolves false — the
   * safe direction, since a missing row can be added and a wrong one has to be
   * hunted down.
   */
  const askBackfill = (): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        'Add the earlier charges?',
        'This starts before today. Add the charges that have already come due, or start from the date you entered?',
        [
          { text: 'Just this one', onPress: () => resolve(false) },
          { text: 'Add them', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });

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
        // Creating a new recurring series. The shape (local-noon anchor,
        // cursor, un-paused/un-skipped) lives in buildRecurringSeries so this
        // screen and the assistant's editor cannot drift apart.
        // Only asked when the start date is genuinely behind us.
        const missed = backfillOccurrences(values.repeatRule, occurredAt, Date.now());
        const backfill = missed.length > 0 ? await askBackfill() : false;
        const series = buildRecurringSeries({
          id: newId(),
          rule: values.repeatRule,
          occurredAt,
          createdAt: Date.now(),
          backfill,
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
        });
        await createSeries(series);
        // The anchor occurrence is the row the user just entered, and the
        // poster no longer mints it (see buildRecurringSeries — doing so is
        // what back-posted a year of charges). Create it here, tagged to the
        // series so it still reads as recurring in the ledger.
        await createTransaction({
          id: newId(),
          accountId: account.id,
          type: values.type,
          amount: values.amountMinor,
          currency,
          categoryId,
          payeeId,
          transferAccountId: values.type === 'transfer' ? values.transferAccountId : null,
          note: values.note.trim() || null,
          occurredAt,
          createdAt: Date.now(),
          source: meta.source,
          receiptRef: null,
          seriesId: series.id,
          occurrenceDate: series.rule.anchor,
          pending: values.pending,
        });
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

  // ── Delete — one implementation, two entry points: the edit sheet's
  // footer button (below) and swipe-reveal's Delete button (renderItem).
  // Both funnel through here, so there's exactly one place that calls
  // deleteTransaction and closes whatever UI surface triggered it.
  const confirmDelete = (tx: Transaction) => {
    if (busy) return; // re-entry guard — a double-tap can't fire two deletes

    let title = 'Delete transaction?';
    let body = 'This removes it from your local ledger.';

    if (tx.type === 'transfer') {
      // A transfer is ONE row (spec §2.3) — deleting it changes both
      // accounts' balances, not just whichever one this list shows it
      // under. Name both, so the blast radius is disclosed up front.
      const fromName = accountsById.get(tx.accountId)?.name ?? 'this account';
      const toName = tx.transferAccountId
        ? accountsById.get(tx.transferAccountId)?.name ?? 'the other account'
        : 'the other account';
      title = 'Delete transfer?';
      body = `This removes the transfer between ${fromName} and ${toName}. Both balances change. This can't be undone.`;
    } else if (tx.seriesId) {
      // Deleting a posted occurrence doesn't stop the series or resurrect
      // this entry on the next run (spec §2.4/§8.2).
      title = 'Delete this occurrence?';
      body = 'The repeating series keeps running — only this entry is removed.';
    }

    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteTransaction(tx.id);
            setSheetOpen(false);
            setOpenRowId(null);
            await refresh();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onDeleteFromSheet = () => {
    const tx = transactions.find((t) => t.id === meta.editingId);
    if (tx) confirmDelete(tx);
  };

  const swipeActionsFor = (tx: Transaction): SwipeAction[] => [
    { key: 'copy', label: 'Copy', icon: 'copy', onPress: () => openCopy(tx) },
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash-2',
      tone: 'negative',
      onPress: () => confirmDelete(tx),
    },
  ];

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
        // A horizontal swipe drag must not also scroll the list (spec §4.7);
        // starting a scroll closes any row a previous swipe left open.
        scrollEnabled={!swiping}
        onScrollBeginDrag={() => setOpenRowId(null)}
        ListHeaderComponent={
          <View className="mb-1">
            <View className="flex-row items-center justify-between mb-3">
              <Pressable
                onPress={() => { setOpenRowId(null); setPeriodSheetOpen(true); }}
                className="flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2"
                accessibilityLabel="Change period"
              >
                <Feather name="calendar" size={14} color={c.muted} />
                <Text className="text-text text-[13px] font-bold ml-2">{sel.label}</Text>
                <Feather name="chevron-down" size={14} color={c.muted} style={{ marginLeft: 4 }} />
              </Pressable>
              {!searchOpen && (
                <Pressable
                  hitSlop={4}
                  onPress={() => setSearchOpen(true)}
                  className="w-9 h-9 rounded-pill bg-surfaceAlt border border-border items-center justify-center"
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

            {/* "Include archived" lens — same shared, session-scoped toggle as
                the Dashboard (spec §5.3/§5.3a), reached from here too so a
                user doesn't have to leave this tab to see archived accounts'
                rows. IncludeArchivedToggle self-gates on hasArchivedAccounts,
                so nothing renders when there's nothing archived. */}
            <IncludeArchivedToggle accounts={accounts} />

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
                        className={`w-10 h-10 rounded-md items-center justify-center ${
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
                        {/* Named like the ledger names the same series' rows —
                            "Netflix", not "Expense". A strip whose job is to
                            say what is coming has to say what it is. */}
                        <Text className="text-text text-sm font-semibold" numberOfLines={1}>
                          {seriesTitle(series.template, {
                            payeeName: series.template.payeeId
                              ? payeesById.get(series.template.payeeId)?.name
                              : undefined,
                            categoryName: series.template.categoryId
                              ? categoriesById.get(series.template.categoryId)?.name
                              : undefined,
                          })}
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
        renderSectionHeader={({ section }) => {
          // This tab spans accounts, so the subtotal is income minus expense
          // and transfers are neutral — moving savings between two of your own
          // accounts is not a day of spending. The account screen asks a
          // different question and uses sectionNetFor instead.
          const net = sectionNetAll(section.data);
          return (
            <View className="flex-row items-baseline mx-1 mt-4 mb-2.5">
              <Text className="text-muted text-xs font-bold uppercase tracking-wide flex-1">
                {section.title}
              </Text>
              {net !== 0 && (
                <Text
                  className={`text-xs font-bold ${net < 0 ? 'text-negative' : 'text-positive'}`}
                >
                  {net > 0 ? '+' : ''}
                  {formatMoney(net, currency)}
                </Text>
              )}
            </View>
          );
        }}
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
            swipeActions={swipeActionsFor(item)}
            swipeOpenKey={openRowId}
            onSwipeOpen={setOpenRowId}
            onSwipeClose={() => setOpenRowId(null)}
            onSwipeActive={setSwiping}
          />
        )}
      />

      {/* FAB */}
      <Pressable
        onPress={openAdd}
        className="absolute right-5 bottom-5 w-14 h-14 rounded-pill bg-primaryFill items-center justify-center"
        style={{ shadowColor: c.primaryFill, ...c.elevation.accentGlow }}
        accessibilityLabel="Add transaction"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>

      {/* Shared transaction form sheet */}
      <TransactionFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          meta.mode === 'edit'
            ? 'Edit transaction'
            : meta.mode === 'copy'
              ? 'Copy transaction'
              : 'Add transaction'
        }
        mode={meta.mode}
        accounts={accounts}
        categories={categories}
        payees={payees}
        currency={currency}
        showRepeat
        copyLabel={meta.copyLabel}
        initial={initial}
        onSave={onSave}
        onDelete={meta.editingId ? onDeleteFromSheet : undefined}
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
