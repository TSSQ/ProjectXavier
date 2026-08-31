/**
 * Account details — the account's balance plus its transactions grouped by day.
 * Period-aware: when opened from the dashboard it receives start/end/label and
 * shows the balance as of the period end with only that period's transactions;
 * when opened from Manage accounts (no period params) it shows the current
 * balance and all transactions.
 *
 * Future-dated rows are listed (with an "Upcoming" chip, via TransactionRow)
 * but never counted in `balance` — a separate "N upcoming · amount" line
 * discloses them instead (docs/design/future-dated-transactions-spec.md §4.3).
 *
 * FAB (bottom-right +): add a transaction pre-filled to this account (locked).
 * Swipe a row left: Copy (duplicate — the form pre-populates with all fields
 * and Add creates a NEW record, not an edit) or Delete. VoiceOver users reach
 * both through the row's accessibilityActions rotor, since a swipe gesture is
 * consumed by the screen reader.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  SectionList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, Category, Payee, Transaction, isUpcoming } from '../../src/domain/types';
import {
  accountBalance,
  accountBalanceAsOf,
  signedAmountFor,
  settledBy,
} from '../../src/domain/balances';
import { inRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { resolveCategoryId } from '../../src/domain/payees';
import {
  sectionNetFor,
  accountBalanceAtEndOfDay,
} from '../../src/domain/balances';
import { compareEdit } from '../../src/domain/parseMetrics';
import { recordEditByTxId } from '../../src/features/diagnostics/parseMetrics';
import { getAccount, listAccounts } from '../../src/features/accounts/repository';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listTransactions,
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
import { newId } from '../../src/lib/id';
import { groupTransactionsByDay, dayLabel } from '../../src/lib/grouping';
import { accountIcon } from '../../src/lib/accountIcon';
import { buildCopyInitial, copyLabelFor } from '../../src/domain/transactionCopy';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { SwipeAction } from '../../src/components/ui/SwipeableRow';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';

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

export default function AccountDetailsScreen() {
  const c = useThemeColors();
  const { id, start, end, label } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
    label?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [account, setAccount] = useState<Account | null>(null);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'add' | 'copy' | 'edit'>('add');
  /** Set only in edit mode. An update must PRESERVE the row's identity —
   *  its id, its original createdAt and its original source. Rebuilding those
   *  from scratch would relabel an AI-parsed row as manual and reset when it
   *  was entered, which is also what the parse metrics measure against. */
  const [editing, setEditing] = useState<{
    id: string;
    createdAt: number;
    source: Transaction['source'];
  } | null>(null);
  const [copyLabel, setCopyLabel] = useState('');
  const [initial, setInitial] = useState<FormValues>(emptyInitial(id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Swipe-reveal (Copy | Delete) ─────────────────────────────────────────
  // Single-open state lives here, not in any row — see SwipeableRow.tsx.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // While a horizontal drag is in progress, the SectionList must not also
  // scroll (spec §4.7).
  const [swiping, setSwiping] = useState(false);
  /** dayStart of the topmost visible section — drives the pinned balance.
   *  null until the list reports, and while the Upcoming section is on top
   *  (a future day has no "balance as of" that means anything). */
  const [visibleDay, setVisibleDay] = useState<number | null>(null);

  const range = useMemo(() => {
    const s = Number(start);
    const e = Number(end);
    return start && end && Number.isFinite(s) && Number.isFinite(e)
      ? { start: s, end: e }
      : null;
  }, [start, end]);

  // ── Data refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!id) return;
    const [acc, txs, accts, cats, pys, cur] = await Promise.all([
      getAccount(id),
      listTransactions(),
      listAccounts(),
      listCategories(),
      listPayees(),
      getCurrency(),
    ]);
    setAccount(acc);
    setAllTx(txs);
    setAllAccounts(accts);
    setCategories(cats);
    setPayees(pys);
    setCurrency(cur);
    // A refresh must not strand a swiped-open row whose transaction is now
    // gone (e.g. deleted from elsewhere) — reconcile by id (spec §4.7/§8.3).
    setOpenRowId((openId) => (openId && txs.some((tx) => tx.id === openId) ? openId : null));
  }, [id]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // ── Derived maps ──────────────────────────────────────────────────────────
  const accountsById = useMemo(
    () => new Map(allAccounts.map((a) => [a.id, a])),
    [allAccounts]
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const payeesById = useMemo(
    () => new Map(payees.map((p) => [p.id, p])),
    [payees]
  );

  const accountTx = useMemo(
    () =>
      allTx.filter(
        (tx) =>
          (tx.accountId === id || tx.transferAccountId === id) &&
          (!range || inRange(tx, range))
      ),
    [allTx, id, range]
  );
  const sections = useMemo(() => groupTransactionsByDay(accountTx), [accountTx]);

  // Device clock — future-dated rows must not count toward the balance below,
  // matching every other money aggregation (docs/design/
  // future-dated-transactions-spec.md).
  //
  // This used to claim `range.end - 1` needed no separate clock because it IS
  // the clock. That holds only for a period that has already finished. For the
  // CURRENT month the period end is in the FUTURE, so a row dated later this
  // month falls inside it and gets counted — while this same screen labels it
  // "1 upcoming" one line above. Reported reading -2,406.74 with a -500 charge
  // due tomorrow, where -1,906.74 is the balance.
  //
  // periodBalancesOf has always clamped this through settledBy for the
  // dashboard. This screen calls accountBalanceAsOf directly and never did.
  const now = Date.now();

  const balance = useMemo(() => {
    if (!account) return 0;
    return range
      ? accountBalanceAsOf(account, allTx, settledBy(range.end - 1, now))
      : accountBalance(account, allTx, now);
  }, [account, allTx, range, now]);

  // Upcoming (future-dated, non-pending) rows within whatever's currently
  // shown (`accountTx` — already period-scoped when `range` is set) — shown
  // as a count/total line SEPARATE from `balance` above, never folded into it
  // (spec §4.3/§4.2 "account detail — upcoming count/total line"). `amount`
  // is always a positive magnitude (see Transaction.amount), so this is a
  // plain sum of what's coming, not a signed balance delta.
  const upcomingTx = useMemo(
    () => accountTx.filter((tx) => isUpcoming(tx, now)),
    [accountTx, now]
  );
  const upcomingCount = upcomingTx.length;
  const upcomingTotal = useMemo(
    () => upcomingTx.reduce((sum, tx) => sum + tx.amount, 0),
    [upcomingTx]
  );

  // ── Sheet open helpers ────────────────────────────────────────────────────
  // Both also clear openRowId — opening a sheet over the list must not leave
  // a swiped-open row stranded underneath it (spec §4.7 "sheets/menus close it").
  const openAdd = () => {
    setInitial(emptyInitial(id));
    setEditing(null);
    setSheetMode('add');
    setCopyLabel('');
    setError(null);
    setOpenRowId(null);
    setSheetOpen(true);
  };

  /** Pre-fill the form from an existing transaction and open as a duplicate. */
  const openCopy = (tx: Transaction) => {
    const pName = tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '';
    const cName = tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '';
    // buildCopyInitial (src/domain/transactionCopy.ts) uses the row's own
    // account, not the route id: for an incoming transfer (tx.accountId is
    // the *other* side, tx.transferAccountId === id) this duplicates the
    // original A→X movement instead of forging a X→X self-transfer.
    // Identical to `id` for expenses/incomes and outgoing transfers, since
    // those only ever appear on their own account's screen.
    const names = { payeeName: pName, categoryName: cName };
    setInitial(buildCopyInitial(tx, { ...names, now: Date.now() }));
    setEditing(null);
    setSheetMode('copy');
    setCopyLabel(copyLabelFor(tx, names));
    setError(null);
    setOpenRowId(null);
    setSheetOpen(true);
  };

  /** Open the row for editing. Seeds accountId from the TRANSACTION, never the
   *  route id — this screen also lists INCOMING transfers, where tx.accountId
   *  is the other side and tx.transferAccountId === id. Seeding the route id
   *  there would rewrite an A→X transfer into an X→X self-transfer on save.
   *  Same reasoning as openCopy's comment above. */
  const openEdit = (tx: Transaction) => {
    const pName = tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '';
    const cName = tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '';
    setInitial({
      accountId: tx.accountId,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amountMinor: tx.amount,
      date: tx.occurredAt,
      categoryName: cName,
      payeeName: pName,
      note: tx.note ?? '',
      repeatRule: null,
      seriesId: tx.seriesId ?? null,
      occurrenceDate: tx.occurrenceDate ?? null,
      pending: tx.pending,
    });
    setEditing({ id: tx.id, createdAt: tx.createdAt, source: tx.source });
    setSheetMode('edit');
    setCopyLabel('');
    setError(null);
    setOpenRowId(null);
    setSheetOpen(true);
  };

  // ── Save (create or update — no recurring series here) ───────────────────
  const onSave = async (values: FormValues) => {
    if (busy) return;

    const acct = accountsById.get(values.accountId);
    if (!acct) { setError('Account not found.'); return; }
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

      const row: Transaction = {
        // Editing keeps the row's identity: same id, same createdAt, same
        // source. Only the fields the form owns change.
        id: editing?.id ?? newId(),
        accountId: acct.id,
        type: values.type,
        amount: values.amountMinor,      // already minor units
        currency,
        categoryId,
        payeeId,
        transferAccountId:
          values.type === 'transfer' ? values.transferAccountId : null,
        note: values.note.trim() || null,
        occurredAt: values.date,
        createdAt: editing?.createdAt ?? Date.now(),
        source: editing?.source ?? 'manual',
        receiptRef: null,
        // Preserve the series link when editing an occurrence; a new row
        // written from this screen never starts a series.
        seriesId: editing ? (values.seriesId ?? null) : null,
        occurrenceDate: editing ? (values.occurrenceDate ?? null) : null,
        pending: values.pending,
      };

      if (editing) {
        // Diagnostics parity with the Transactions tab: an edit to an
        // AI-parsed row is a correction, and the parse metrics are supposed to
        // count it. Recording it on one screen and not the other would make
        // the measurement depend on which screen the user happened to open.
        const prior = allTx.find((t) => t.id === editing.id);
        await updateTransaction(row);
        if (prior && prior.source === 'ai') {
          void recordEditByTxId(
            prior.id,
            compareEdit(
              {
                amount: prior.amount,
                type: prior.type,
                payeeName: prior.payeeId ? payeesById.get(prior.payeeId)?.name ?? null : null,
                categoryName: prior.categoryId
                  ? categoriesById.get(prior.categoryId)?.name ?? null
                  : null,
                occurredAt: prior.occurredAt,
              },
              {
                amount: row.amount,
                type: row.type,
                payeeName: payeeName || null,
                categoryName: categoryName || null,
                occurredAt: row.occurredAt,
              }
            )
          );
        }
      } else {
        await createTransaction(row);
      }

      await refresh();
      setSheetOpen(false);
    } catch (e) {
      setError(`Could not save. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Delete (new on this screen — see spec §2.1/§11.1) ────────────────────
  const confirmDelete = (tx: Transaction) => {
    if (busy) return; // re-entry guard — a double-tap can't fire two deletes

    let title = 'Delete transaction?';
    let body = 'This removes it from your local ledger.';

    if (tx.type === 'transfer') {
      // A transfer is ONE row (spec §2.3). This screen also lists INCOMING
      // transfers (tx.accountId is the *other* account, tx.transferAccountId
      // === id) — deleting one here rewrites that other account's balance
      // too, which today is only possible from this new swipe path. Name
      // both accounts and never phrase this as "delete this transaction"
      // (spec §8.1).
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
            setOpenRowId(null);
            await refresh();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
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

  // React Native rejects a changed onViewableItemsChanged/viewabilityConfig
  // after mount ("Changing onViewableItemsChanged on the fly is not
  // supported"), so both live in refs and read fresh state through one.
  // Read through a ref so the stable callback below still sees today's date.
  const todayStartRef = React.useRef(0);
  todayStartRef.current = new Date(now).setHours(0, 0, 0, 0);
  const viewabilityConfig = React.useRef({
    // A header counts as visible the moment any of it is on screen; waiting
    // for a percentage makes the pinned value lag a row behind the scroll.
    itemVisiblePercentThreshold: 0,
    minimumViewTime: 0,
  }).current;
  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: { section?: { dayStart: number } }[] }) => {
      // viewableItems arrives in list order, so the first entry is the
      // topmost. The Upcoming section carries a REAL future dayStart rather
      // than a sentinel, and a balance "as of" a day that has not happened is
      // not a thing — so pin nothing while it is on top. Tested against today
      // rather than the section title, which is display copy and would take
      // this logic down with it if reworded.
      const top = viewableItems[0]?.section?.dayStart;
      setVisibleDay(top == null || top > todayStartRef.current ? null : top);
    }
  ).current;

  const scrolledBalance = useMemo(() => {
    if (!account || visibleDay == null) return null;
    return accountBalanceAtEndOfDay(account, accountTx, visibleDay);
  }, [account, accountTx, visibleDay]);

  // ── Render ────────────────────────────────────────────────────────────────
  const backButton = (
    <Pressable
      onPress={() => router.back()}
      className="flex-row items-center mb-4"
      accessibilityLabel="Back"
    >
      <Feather name="chevron-left" size={22} color={c.muted} />
      <Text className="text-muted text-base ml-1">Back</Text>
    </Pressable>
  );

  if (!account) {
    return (
      <View className="flex-1 bg-bg px-6 pt-14">
        {backButton}
        <Text className="text-muted mt-6">Account not found.</Text>
      </View>
    );
  }

  const { emoji, bg } = accountIcon(account);
  const meta = [account.subtype, account.tag].filter(Boolean).join(' · ') || 'Account';

  return (
    <View className="flex-1 bg-bg">
      {/* Balance as of the day currently at the top of the list. Absolutely
          positioned so it floats over the scroll without the SectionList
          having to reserve height for it — the header block already sits
          under the safe area, and reserving space would push the account's
          own balance down by a bar that is empty on first paint.

          Hidden while the Upcoming section is on top (scrolledBalance is
          null): those days have not happened, so there is no balance "as of"
          them. Also hidden before the list has reported any visible item,
          which is why the account's real balance stays readable at rest. */}
      {scrolledBalance !== null && (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 z-10 flex-row items-baseline px-6 py-2 bg-surface border-b border-border"
          style={{ top: insets.top }}
        >
          <Text className="text-muted text-[11px] font-bold uppercase tracking-wide flex-1">
            {`as of ${dayLabel(visibleDay!, now)}`}
          </Text>
          <Text
            className={`text-sm font-extrabold ${
              scrolledBalance < 0 ? 'text-negative' : 'text-text'
            }`}
          >
            {formatMoney(scrolledBalance, currency)}
          </Text>
        </View>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 96 }}
        stickySectionHeadersEnabled={false}
        // A horizontal swipe drag must not also scroll the list (spec §4.7);
        // starting a scroll closes any row a previous swipe left open.
        scrollEnabled={!swiping}
        onScrollBeginDrag={() => setOpenRowId(null)}
        ListHeaderComponent={
          <View className="mb-2">
            {backButton}
            <View className="items-center mb-4">
              <View className={`w-16 h-16 rounded-2xl items-center justify-center ${bg}`}>
                <Text className="text-3xl">{emoji}</Text>
              </View>
              <Text className="text-text text-lg font-bold mt-3">{account.name}</Text>
              <Text className="text-muted text-xs mt-0.5">{meta}</Text>
              <Text
                className={`text-[32px] font-extrabold mt-2 ${
                  balance < 0 ? 'text-negative' : 'text-text'
                }`}
              >
                {formatMoney(balance, currency)}
              </Text>
              {range && (
                <Text className="text-muted text-xs mt-1">as of {label ?? 'period'}</Text>
              )}
              {/* Upcoming (future-dated) rows, disclosed but kept OUT of the
                  balance above (spec §4.3) — a separate line, never folded in. */}
              {upcomingCount > 0 && (
                <Text className="text-muted text-xs mt-1">
                  {upcomingCount} upcoming · {formatMoney(upcomingTotal, currency)}
                </Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-muted text-center mt-6">
            {range
              ? 'No transactions in this period.'
              : 'No transactions yet — tap + to add one.'}
          </Text>
        }
        renderSectionHeader={({ section }) => {
          // Sums the rows printed directly below, pending and future-dated
          // included — see sectionNetFor on why this is not the gated path.
          const net = sectionNetFor(section.data, id);
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
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
            onPress={() => openEdit(item)}
            transferAccountName={
              item.transferAccountId
                ? accountsById.get(item.transferAccountId)?.name
                : undefined
            }
            categoryName={
              item.categoryId ? categoriesById.get(item.categoryId)?.name : undefined
            }
            payeeName={
              item.payeeId ? payeesById.get(item.payeeId)?.name : undefined
            }
            // The row shows what the transaction IS, not what it currently
            // contributes: signedDelta returns 0 for a future-dated or pending
            // row, which rendered a real charge as $0.00. Direction still
            // depends on which side of a transfer this account is on, so the
            // amount can't just be tx.amount. Whether it counts is already
            // said by the Upcoming/Pending chip.
            signedAmount={signedAmountFor(item, account.id)}
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
        className="absolute right-5 bottom-5 w-14 h-14 rounded-full bg-primaryFill items-center justify-center"
        style={{
          shadowColor: c.primaryFill,
          ...c.elevation.accentGlow,
        }}
        accessibilityLabel="Add transaction"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>

      {/* Shared transaction form sheet — account locked to this route */}
      <TransactionFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          sheetMode === 'copy'
            ? 'Copy transaction'
            : sheetMode === 'edit'
              ? 'Edit transaction'
              : 'Add transaction'
        }
        mode={sheetMode}
        accounts={allAccounts}
        categories={categories}
        payees={payees}
        currency={currency}
        // Follows the seeded `initial.accountId`, not always the route id: in
        // copy mode of an incoming transfer that's the original source
        // account (see openCopy), not the account currently being viewed.
        lockedAccountId={initial.accountId}
        copyLabel={copyLabel}
        initial={initial}
        onSave={onSave}
        busy={busy}
        error={error}
      />
    </View>
  );
}
