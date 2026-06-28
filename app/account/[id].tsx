/**
 * Account details — the account's balance plus its transactions grouped by day.
 * Period-aware: when opened from the dashboard it receives start/end/label and
 * shows the balance as of the period end with only that period's transactions;
 * when opened from Manage accounts (no period params) it shows the current
 * balance and all transactions.
 *
 * FAB (bottom-right +): add a transaction pre-filled to this account.
 * Long-press a row: duplicate that transaction — form pre-populates with all
 * fields; pressing Add creates a new record (not an edit).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  GestureResponderEvent,
  SectionList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import { accountBalance, accountBalanceAsOf, signedDelta } from '../../src/domain/balances';
import { inRange } from '../../src/domain/period';
import { formatMoney, toMajorUnits, toMinorUnits } from '../../src/domain/money';
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
import { Input } from '../../src/components/ui/Input';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { DateField } from '../../src/components/ui/DateField';
import { Combobox, ComboItem } from '../../src/components/ui/Combobox';
import { Button } from '../../src/components/ui/Button';
import { ContextMenu } from '../../src/components/ui/ContextMenu';

type TxType = Transaction['type'];

interface FormState {
  accountId: string;
  transferAccountId: string;
  type: TxType;
  amount: string;
  date: number;
  categoryName: string;
  payeeName: string;
  note: string;
  /** True when the form was seeded from an existing transaction (duplicate). */
  isCopy: boolean;
  copyLabel: string;
}

const emptyForm = (accountId = ''): FormState => ({
  accountId,
  transferAccountId: '',
  type: 'expense',
  amount: '',
  date: Date.now(),
  categoryName: '',
  payeeName: '',
  note: '',
  isCopy: false,
  copyLabel: '',
});

export default function AccountDetailsScreen() {
  const { id, start, end, label } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
    label?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [account, setAccount] = useState<Account | null>(null);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // Form / sheet state
  const [form, setForm] = useState<FormState>(emptyForm(id));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Context menu state
  const [menuTx, setMenuTx] = useState<Transaction | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const range = useMemo(() => {
    const s = Number(start);
    const e = Number(end);
    return start && end && Number.isFinite(s) && Number.isFinite(e)
      ? { start: s, end: e }
      : null;
  }, [start, end]);

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

  // ── derived maps ──────────────────────────────────────────────────────────
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
  const activeAccounts = allAccounts.filter((a) => !a.archived);
  const transferChoices = activeAccounts.filter((a) => a.id !== form.accountId);

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

  // ── form handlers ─────────────────────────────────────────────────────────
  const updateForm = (patch: Partial<FormState>) => {
    setForm((cur) => ({ ...cur, ...patch }));
    setError(null);
  };

  const openAdd = () => {
    setForm(emptyForm(id));
    setError(null);
    setSheetOpen(true);
  };

  /** Pre-fill the form from an existing transaction and open as a duplicate. */
  const openCopy = (tx: Transaction) => {
    const payeeName = tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '';
    const categoryName = tx.categoryId
      ? (categoriesById.get(tx.categoryId)?.name ?? '')
      : '';
    setForm({
      accountId: id,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amount: toMajorUnits(tx.amount).toFixed(2),
      date: Date.now(),
      categoryName,
      payeeName,
      note: tx.note ?? '',
      isCopy: true,
      copyLabel: payeeName || categoryName || sentenceCase(tx.type),
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
    const acct = accountsById.get(form.accountId);
    const amount = Number(form.amount);

    if (!acct) return setError('Account not found.');
    if (!Number.isFinite(amount) || amount <= 0)
      return setError('Enter an amount greater than zero.');
    if (form.type === 'transfer' && !form.transferAccountId)
      return setError('Choose where the transfer goes.');

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

      await createTransaction({
        id: newId(),
        accountId: acct.id,
        type: form.type,
        amount: toMinorUnits(amount),
        currency,
        categoryId,
        payeeId,
        transferAccountId:
          form.type === 'transfer' ? form.transferAccountId : null,
        note: form.note.trim() || null,
        occurredAt: form.date,
        createdAt: Date.now(),
        source: 'manual',
        receiptRef: null,
      });

      await refresh();
      setSheetOpen(false);
    } catch (e) {
      setError(`Could not save. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  const backButton = (
    <Pressable
      onPress={() => router.back()}
      className="flex-row items-center mb-4"
      accessibilityLabel="Back"
    >
      <Feather name="chevron-left" size={22} color="#9AA4B2" />
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
          shadowColor: '#5B8DEF',
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

      {/* Add / duplicate transaction sheet */}
      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={form.isCopy ? 'Copy transaction' : 'Add transaction'}
      >
        <View style={{ gap: 10 }}>
          {form.isCopy && (
            <View className="flex-row items-center gap-2 bg-surfaceAlt border border-border rounded-md px-3 py-2">
              <Feather name="copy" size={13} color="#9AA4B2" />
              <Text className="text-muted text-xs">Copying · {form.copyLabel}</Text>
            </View>
          )}

          <SegmentedControl
            options={['expense', 'income', 'transfer'] as TxType[]}
            value={form.type}
            onChange={(t) => updateForm({ type: t as TxType })}
          />

          {/* Account — locked to the current account */}
          <View className="bg-surfaceAlt border border-border rounded-sm px-3 py-2.5">
            <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mb-0.5">
              Account
            </Text>
            <Text className="text-text text-sm font-semibold">{account.name}</Text>
          </View>

          {form.type === 'transfer' && (
            <>
              <Text className="text-muted text-xs font-semibold">To account</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {transferChoices.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => updateForm({ transferAccountId: a.id })}
                    className={`rounded-pill px-4 py-2 ${
                      form.transferAccountId === a.id ? 'bg-primary' : 'bg-surfaceAlt'
                    }`}
                  >
                    <Text
                      className={
                        form.transferAccountId === a.id
                          ? 'text-white text-[13px] font-semibold'
                          : 'text-muted text-[13px]'
                      }
                    >
                      {a.name}
                    </Text>
                  </Pressable>
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

          {error && <Text className="text-negative text-xs">{error}</Text>}
          <Text className="text-muted text-xs">{currency}</Text>
          <Button title="Add" onPress={onSave} loading={busy} />
        </View>
      </BottomSheet>
    </View>
  );
}

function sentenceCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
