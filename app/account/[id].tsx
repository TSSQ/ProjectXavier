/**
 * Account details — the account's balance plus its transactions grouped by day.
 * Period-aware: when opened from the dashboard it receives start/end/label and
 * shows the balance as of the period end with only that period's transactions;
 * when opened from Manage accounts (no period params) it shows the current
 * balance and all transactions.
 *
 * FAB (bottom-right +): add a transaction pre-filled to this account (locked).
 * Long-press a row: duplicate that transaction — form pre-populates with all
 * fields; pressing Add creates a new record (not an edit).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  GestureResponderEvent,
  SectionList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import { accountBalance, accountBalanceAsOf, signedDelta } from '../../src/domain/balances';
import { inRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { resolveCategoryId } from '../../src/domain/payees';
import { getAccount, listAccounts } from '../../src/features/accounts/repository';
import {
  createTransaction,
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
import { groupTransactionsByDay } from '../../src/lib/grouping';
import { accountIcon } from '../../src/lib/accountIcon';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { ContextMenu } from '../../src/components/ui/ContextMenu';
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
  const [sheetMode, setSheetMode] = useState<'add' | 'copy'>('add');
  const [copyLabel, setCopyLabel] = useState('');
  const [initial, setInitial] = useState<FormValues>(emptyInitial(id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Context menu ──────────────────────────────────────────────────────────
  const [menuTx, setMenuTx] = useState<Transaction | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

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

  const balance = useMemo(() => {
    if (!account) return 0;
    return range
      ? accountBalanceAsOf(account, allTx, range.end - 1)
      : accountBalance(account, allTx);
  }, [account, allTx, range]);

  // ── Sheet open helpers ────────────────────────────────────────────────────
  const openAdd = () => {
    setInitial(emptyInitial(id));
    setSheetMode('add');
    setCopyLabel('');
    setError(null);
    setSheetOpen(true);
  };

  /** Pre-fill the form from an existing transaction and open as a duplicate. */
  const openCopy = (tx: Transaction) => {
    const pName = tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '';
    const cName = tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '';
    setInitial({
      accountId: id,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amountMinor: tx.amount,          // already minor units
      date: Date.now(),
      categoryName: cName,
      payeeName: pName,
      note: tx.note ?? '',
      repeatRule: null,
      seriesId: null,
      occurrenceDate: null,
    });
    setSheetMode('copy');
    setCopyLabel(pName || cName || sentenceCase(tx.type));
    setError(null);
    setSheetOpen(true);
  };

  // ── Save (create-only — no recurring series, no diagnostics) ─────────────
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

      await createTransaction({
        id: newId(),
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
        createdAt: Date.now(),
        source: 'manual',
        receiptRef: null,
        seriesId: null,
        occurrenceDate: null,
      });

      await refresh();
      setSheetOpen(false);
    } catch (e) {
      setError(`Could not save. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(false);
    }
  };

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
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 96 }}
        stickySectionHeadersEnabled={false}
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
        renderSectionHeader={({ section }) => (
          <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mt-4 mb-2.5">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
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
            signedAmount={signedDelta(item, account.id)}
            onLongPress={(e: GestureResponderEvent) => {
              setMenuTx(item);
              setMenuPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
            }}
          />
        )}
      />

      {/* FAB */}
      <Pressable
        onPress={openAdd}
        className="absolute right-5 bottom-5 w-14 h-14 rounded-full bg-primary items-center justify-center"
        style={{
          shadowColor: c.primary,
          shadowOpacity: 0.5,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
        accessibilityLabel="Add transaction"
      >
        <Feather name="plus" size={26} color="#fff" />
      </Pressable>

      {/* Long-press context menu */}
      <ContextMenu
        visible={menuTx !== null}
        x={menuPos.x}
        y={menuPos.y}
        onDismiss={() => setMenuTx(null)}
        items={[
          {
            label: 'Copy transaction',
            icon: 'copy',
            onPress: () => { if (menuTx) openCopy(menuTx); },
          },
        ]}
      />

      {/* Shared transaction form sheet — account locked to this route */}
      <TransactionFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'copy' ? 'Copy transaction' : 'Add transaction'}
        mode={sheetMode}
        accounts={allAccounts}
        categories={categories}
        payees={payees}
        currency={currency}
        lockedAccountId={id}
        copyLabel={copyLabel}
        initial={initial}
        onSave={onSave}
        busy={busy}
        error={error}
      />
    </View>
  );
}

function sentenceCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
