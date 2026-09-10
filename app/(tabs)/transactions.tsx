/**
 * Transactions — a clean, searchable ledger grouped by day. Adding/editing is
 * done in TransactionFormSheet (bottom-sheet dialog): a floating "+" opens Add;
 * tapping a row opens Edit (with delete). Search is tap-to-reveal from the top
 * bar. Period filtering is done via PeriodSheet.
 */
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { useIncludeArchived } from '../../src/context/useIncludeArchived';
import {
  Alert,
  SectionList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Account, Category, Payee, Transaction, RecurringSeries } from '../../src/domain/types';
import { formatMoney } from '../../src/domain/money';
import {
  matchesSearch,
  selectUpcoming,
  SearchLookups,
} from '../../src/domain/searchMatch';
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
import { DepthField } from '../../src/components/ui/DepthField';
import { Fab } from '../../src/components/ui/Fab';
import { IconButton } from '../../src/components/ui/IconButton';
import { Input } from '../../src/components/ui/Input';
import { ICON } from '../../src/theme/assets';
import { SIZE } from '../../src/theme/tokens';
import {
  ScreenHeader,
  SCREEN_HEADER_ESTIMATE,
  useScreenHeaderScroll,
} from '../../src/components/ui/ScreenHeader';
import { takeDeepLinkToken } from '../../src/domain/deepLinkToken';

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

// glass-phase2 §4.2: the root SafeAreaProvider (expo-router's ExpoRoot wraps
// the whole app in one, above the NativeTabs view controllers) measured
// insets.bottom = 34 — home-indicator only, it can't see the tab VC's
// additionalSafeAreaInsets. A SafeAreaProvider nested INSIDE this screen
// measures its own native anchor instead and picks up the floating bar:
// insets.bottom = 83 on iPhone 17 Pro, matching the spec's expected range.
export default function TransactionsScreen() {
  return (
    <SafeAreaProvider>
      <TransactionsScreenInner />
    </SafeAreaProvider>
  );
}

function TransactionsScreenInner() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Quick-action "Add manually" deep link (?add=<token>) — see the effect near
  // openAdd's definition below.
  const params = useLocalSearchParams<{ add?: string }>();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  // Measured height of the sticky ScreenHeader (D2) — drives the list's own
  // paddingTop so content clears the glass bar.
  const [headerHeight, setHeaderHeight] = useState(insets.top + SCREEN_HEADER_ESTIMATE);
  const [initial, setInitial] = useState<FormValues>(emptyInitial);
  /** Screen-specific fields the form component doesn't need to know about. */
  const [meta, setMeta] = useState<SheetMeta>(emptyMeta);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  // Hide-on-scroll (transparent-hiding-header-spec.md) — `locked` while
  // search is open: sliding a focused text field off screen mid-typing is a
  // bug, not a nicety, so the header must stay fully shown for as long as
  // `searchOpen` is true.
  const headerScroll = useScreenHeaderScroll({ headerHeight, locked: searchOpen });
  const [query, setQuery] = useState('');
  // iOS commits a pending autocorrect through onChangeText AFTER the field
  // unmounts on Close, so `query` can hold a stale value while the search is
  // closed. Filter on this derived value, and reset on Open, so that stale
  // value never reaches the list or the reopened field.
  const activeQuery = searchOpen ? query : '';
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

  // Name lookups for the shared search predicate. Both the ledger and the
  // Upcoming section match through it, so a query can never filter one and
  // leave the other showing unrelated rows (device feedback, build 109).
  const searchLookups = useMemo<SearchLookups>(
    () => ({
      payeeName: (id) => (id ? payeesById.get(id)?.name : undefined),
      categoryName: (id) => (id ? categoriesById.get(id)?.name : undefined),
      accountName: (id) => accountsById.get(id)?.name,
    }),
    [payeesById, categoriesById, accountsById]
  );

  const filtered = useMemo(() => {
    if (!activeQuery.trim()) return periodTx;
    return periodTx.filter((tx) => matchesSearch(tx, activeQuery, searchLookups));
  }, [periodTx, activeQuery, searchLookups]);

  // Passing the clock collects future-dated rows into one leading "Upcoming"
  // section instead of scattering them across day headings above today, where
  // a scheduled charge reads as something that already happened.
  const sections = useMemo(() => groupTransactionsByDay(filtered, Date.now()), [filtered]);

  const upcomingItems = useMemo(
    () =>
      selectUpcoming<RecurringSeries>({
        series: allSeries,
        now: Date.now(),
        windowMs: UPCOMING_WINDOW_MS,
        query: activeQuery,
        lookups: searchLookups,
        isInactive: (s) => s.paused || s.archived,
        templateOf: (s) => s.template,
        nextOccurrence: (s, now) => upcomingOccurrences(s, now, 1)[0] ?? null,
      }).map(({ series, date }) => ({ key: series.id, series, date })),
    [allSeries, activeQuery, searchLookups]
  );

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
  useEffect(() => { setOpenRowId(null); }, [activeQuery]);

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

  // Quick-action chip deep link (index.tsx's "Add manually" chip →
  // /transactions?add=<Date.now()>, glass-chrome-adoption-spec.md D3.2): opens Add once
  // per navigation, then clears the param so a later visit to this tab
  // doesn't reopen it. NOTE openAdd() is NOT idempotent — it resets the form
  // (initial values, meta, error) — which is exactly why the token guard
  // below must stay: without it, tab-away-and-back would wipe an in-progress
  // entry (QA round 1).
  // Guarded by a ref like index.tsx's widget deep links: expo-router keeps a
  // tab's query params around across tab switches, so clearing the param is
  // not enough on its own — without the ref, Transactions → Dashboard →
  // Transactions would call openAdd() again and wipe an in-progress entry.
  // The chip sends a fresh token per tap (`add=<timestamp>`), so a second tap
  // is a new value and opens again, while a stale value is ignored for good.
  const addHandledRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const { handle, lastHandled } = takeDeepLinkToken(addHandledRef.current, params.add);
      addHandledRef.current = lastHandled;
      if (!handle) return;
      openAdd();
      router.setParams({ add: undefined });
      // openAdd/router are intentionally not deps: the ref, not the array, is
      // what makes this once-per-token.
    }, [params.add])
  );

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
    if (values.type === 'transfer') {
      if (!values.transferAccountId) {
        setError('Choose where the transfer goes.');
        return;
      }
      // Mirrors the source-account check above: a deleted destination
      // leaves `transferAccountId` a dangling id (the picker just shows it
      // blank — see TransactionFormSheet), and nothing else on this path
      // checks it before createTransaction/updateTransaction write it.
      if (!accountsById.get(values.transferAccountId)) {
        setError('That destination account no longer exists — choose another.');
        return;
      }
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
      {/* First child, absolutely filling, content above it (glass-phase2 §4.6) */}
      <DepthField />
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{
          padding: 24,
          paddingTop: headerHeight + 12,
          // NativeTabs floats the bar over the content (glass-phase2 §4.2) —
          // the last row and the FAB below must clear it explicitly. Same
          // expression as the other four Fab screens (SIZE.fab + 20 + the
          // FAB's own bottom gap) so this can't drift from the component.
          paddingBottom: SIZE.fab + 20 + insets.bottom,
        }}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: headerHeight }}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        // A horizontal swipe drag must not also scroll the list (spec §4.7);
        // starting a scroll closes any row a previous swipe left open.
        scrollEnabled={!swiping}
        onScrollBeginDrag={() => setOpenRowId(null)}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View className="mb-1">
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
            {activeQuery ? 'No matching transactions.' : 'Tap + to add your first transaction.'}
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

      <ScreenHeader
        title="Transactions"
        period={{
          label: sel.label,
          onPress: () => { setOpenRowId(null); setPeriodSheetOpen(true); },
        }}
        right={
          !searchOpen ? (
            <IconButton
              size="md"
              tone="clear"
              icon="search"
              onPress={() => { setQuery(''); setSearchOpen(true); }}
              accessibilityLabel="Search transactions"
            />
          ) : undefined
        }
        below={
          // The field itself is `Input` now (glass-standard-adoption-spec.md
          // S5) — it paints its own surface/border/focus, so the row that
          // used to carry a static `border-primary` just lays the field and
          // close button out; the primary border only appears while the
          // field is actually focused. The search glyph overlays INSIDE
          // Input's own box (absolute, `pointerEvents="none"`, `pl-9`
          // clears it) rather than sitting beside it as a flex sibling
          // (QA round 3: that put the glyph outside the field's border box
          // entirely, which S5 never authorised — it only authorised
          // dropping the row's own static `border-primary`).
          searchOpen ? (
            <View className="flex-row items-center mt-3" style={{ gap: 8 }}>
              <View style={{ position: 'relative', flex: 1 }}>
                <Input
                  className="pl-9"
                  placeholder="Search payee, category, note…"
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                />
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', left: 12, top: 0, bottom: 0, justifyContent: 'center' }}
                >
                  <Feather name="search" size={ICON.md} color={c.muted} />
                </View>
              </View>
              <Pressable
                onPress={() => { setQuery(''); setSearchOpen(false); }}
                accessibilityLabel="Close search"
              >
                <Feather name="x" size={18} color={c.muted} />
              </Pressable>
            </View>
          ) : undefined
        }
        onHeight={setHeaderHeight}
        scroll={headerScroll}
      />

      {/* FAB (glass-standard-adoption-spec.md S1) — position/size/label live
          in Fab.tsx now; this screen only supplies the action. */}
      <Fab onPress={openAdd} accessibilityLabel="Add transaction" />

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
