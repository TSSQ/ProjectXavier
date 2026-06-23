/**
 * Account details — the account's balance plus its transactions grouped by day.
 * Period-aware: when opened from the dashboard it receives start/end/label and
 * shows the balance as of the period end with only that period's transactions;
 * when opened from Manage accounts (no period params) it shows the current
 * balance and all transactions. Transfers show the correct per-account sign.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Account, Transaction } from '../../src/domain/types';
import { accountBalance, accountBalanceAsOf, signedDelta } from '../../src/domain/balances';
import { inRange } from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import { getAccount, listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../../src/features/settings/repository';
import { groupTransactionsByDay } from '../../src/lib/grouping';
import { accountIcon } from '../../src/lib/accountIcon';
import { TransactionRow } from '../../src/components/ui/TransactionRow';

export default function AccountDetailsScreen() {
  const { id, start, end, label } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
    label?: string;
  }>();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [payeeNames, setPayeeNames] = useState<Map<string, string>>(new Map());
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // Period scope only when both bounds are supplied (entry from the dashboard).
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
    setAccountNames(new Map(accts.map((a) => [a.id, a.name])));
    setCategoryNames(new Map(cats.map((c) => [c.id, c.name])));
    setPayeeNames(new Map(pys.map((p) => [p.id, p.name])));
    setCurrency(cur);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
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
        contentContainerStyle={{ padding: 24, paddingTop: 56 }}
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
            {range ? 'No transactions in this period.' : 'No transactions in this account yet.'}
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
              item.transferAccountId ? accountNames.get(item.transferAccountId) : undefined
            }
            categoryName={item.categoryId ? categoryNames.get(item.categoryId) : undefined}
            payeeName={item.payeeId ? payeeNames.get(item.payeeId) : undefined}
            signedAmount={signedDelta(item, account.id)}
          />
        )}
      />
    </View>
  );
}
