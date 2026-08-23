/**
 * Recurring series management — list all active recurring series with edit,
 * pause/resume, skip-next, and delete (archive) actions.
 * Navigated to from Dashboard › Manage.
 *
 * Editing applies FROM THE NEXT OCCURRENCE ONWARD: rows already posted are
 * history and are never rewritten. That is splitAndContinue — the current
 * series is truncated the day before the split point and a continuation
 * carries the new schedule and template from there.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Category, Payee, RecurringSeries } from '../src/domain/types';
import {
  listSeries,
  updateSeries,
  skipNextOccurrence,
  splitAndContinue,
} from '../src/features/recurring/repository';
import { listAccounts } from '../src/features/accounts/repository';
import { listPayees, findOrCreateByName as findOrCreatePayee, getPayeeByName } from '../src/features/payees/repository';
import { listCategories, findOrCreateByName as findOrCreateCategory } from '../src/features/categories/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../src/features/settings/repository';
import { resolveCategoryId } from '../src/domain/payees';
import {
  TransactionFormSheet,
  FormValues,
} from '../src/components/transactions/TransactionFormSheet';
import {
  upcomingOccurrences,
  describeRule,
  hasArchivedTarget,
  seriesTitle,
} from '../src/domain/recurrence';
import { formatMoney } from '../src/domain/money';
import { useThemeColors } from '../src/theme/useThemeColors';

function nextDueLabel(series: RecurringSeries): string {
  const [next] = upcomingOccurrences(series, Date.now(), 1);
  if (!next) return 'No more occurrences';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(next));
}

function seriesIcon(s: RecurringSeries): string {
  return s.template.type === 'income' ? '💰' : s.template.type === 'transfer' ? '🔁' : '🧾';
}

function seriesIconBg(s: RecurringSeries): string {
  return s.template.type === 'income'
    ? 'bg-chipIncome'
    : s.template.type === 'transfer'
      ? 'bg-chipTransfer'
      : 'bg-chipExpense';
}

export default function RecurringScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seriesList, setSeriesList] = useState<RecurringSeries[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Names for the series title — a series stores payee/category as ids, and
  // titling by type alone ("Expense") tells the user nothing about what is
  // about to be charged. See seriesTitle.
  const [payeesById, setPayeesById] = useState<Map<string, string>>(new Map());
  const [categoriesById, setCategoriesById] = useState<Map<string, string>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  // Editing a series edits it FROM THE NEXT OCCURRENCE ONWARD — rows already
  // posted are history and stay exactly as they are (splitAndContinue).
  const [editing, setEditing] = useState<{ series: RecurringSeries; from: number } | null>(null);
  const [editInitial, setEditInitial] = useState<FormValues | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, accts, pys, cats, cur] = await Promise.all([
      listSeries(),
      listAccounts(),
      listPayees(),
      listCategories(),
      getCurrency(),
    ]);
    setCurrency(cur);
    setSeriesList(list.filter((s) => !s.archived));
    setAccounts(accts);
    setPayees(pys);
    setCategories(cats);
    setPayeesById(new Map(pys.map((x) => [x.id, x.name])));
    setCategoriesById(new Map(cats.map((x) => [x.id, x.name])));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const togglePause = async (s: RecurringSeries) => {
    await updateSeries({ ...s, paused: !s.paused });
    await refresh();
  };

  const onSkipNext = (s: RecurringSeries) => {
    Alert.alert(
      'Skip next occurrence?',
      'The next scheduled occurrence will be skipped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          onPress: async () => {
            await skipNextOccurrence(s, Date.now());
            await refresh();
          },
        },
      ],
    );
  };

  /** Open the editor seeded from the series, dated at its NEXT occurrence —
   *  that date is the split point, and the form's own date row lets the user
   *  move it if they want the change to start later. */
  const onEdit = (s: RecurringSeries) => {
    const [next] = upcomingOccurrences(s, Date.now(), 1);
    if (next == null) {
      Alert.alert('Nothing left to change', 'This series has no upcoming occurrences.');
      return;
    }
    setEditing({ series: s, from: next });
    setEditError(null);
    setEditInitial({
      accountId: s.template.accountId,
      transferAccountId: s.template.transferAccountId ?? '',
      type: s.template.type,
      amountMinor: s.template.amount,
      date: next,
      categoryName: s.template.categoryId ? (categoriesById.get(s.template.categoryId) ?? '') : '',
      payeeName: s.template.payeeId ? (payeesById.get(s.template.payeeId) ?? '') : '',
      note: s.template.note ?? '',
      repeatRule: s.rule,
      seriesId: s.id,
      occurrenceDate: next,
      pending: false,
    });
  };

  const onEditSave = async (values: FormValues) => {
    if (!editing || editBusy) return;
    if (values.type === 'transfer' && !values.transferAccountId) {
      setEditError('Choose where the transfer goes.');
      return;
    }
    if (!values.repeatRule) {
      setEditError('A repeating transaction needs a schedule.');
      return;
    }
    setEditBusy(true);
    try {
      // Resolve names to ids the same way the transaction screens do, so an
      // edited series can introduce a new payee/category like any other entry.
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
        payeeId = existing ? existing.id : await findOrCreatePayee(payeeName, categoryId);
      }
      await splitAndContinue(
        editing.series,
        values.date,
        {
          accountId: values.accountId,
          type: values.type,
          amount: values.amountMinor,
          currency,
          categoryId,
          payeeId,
          transferAccountId: values.type === 'transfer' ? values.transferAccountId : null,
          note: values.note.trim() || null,
        },
        Date.now(),
        values.repeatRule,
      );
      setEditing(null);
      setEditInitial(null);
      await refresh();
    } catch {
      setEditError('Could not save the change.');
    } finally {
      setEditBusy(false);
    }
  };

  const onDelete = (s: RecurringSeries) => {
    Alert.alert(
      'Delete recurring series?',
      'Future occurrences will stop. Past transactions remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await updateSeries({ ...s, archived: true });
            await refresh();
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 py-3 border-b border-border">
        <Pressable
          onPress={() => router.back()}
          className="mr-3 w-9 h-9 rounded-full bg-surfaceAlt border border-border items-center justify-center"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={18} color={c.muted} />
        </Pressable>
        <Text className="text-text text-xl font-extrabold flex-1">Recurring</Text>
      </View>

      <FlatList
        data={seriesList}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        ListEmptyComponent={
          <Text className="text-muted text-center mt-10 leading-6">
            No recurring transactions yet.{'\n'}Add one with the + button on Transactions.
          </Text>
        }
        renderItem={({ item: s }) => {
          // A series whose target account is archived is paused (spec
          // §8.3) without any flag written on the series itself — derived
          // purely from current account state, so it must be recomputed on
          // every render rather than cached anywhere. Unrelated to
          // `s.archived`, which is this screen's own soft-delete (§8.3
          // warns explicitly against conflating the two).
          const accountArchived = hasArchivedTarget(s, accounts);
          return (
            <View className="bg-surface border border-border rounded-xl mb-3 p-4">
              <View className="flex-row items-center mb-3" style={{ gap: 12 }}>
                <View
                  className={`w-10 h-10 rounded-xl items-center justify-center ${seriesIconBg(s)}`}
                >
                  <Text className="text-lg">{seriesIcon(s)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-text text-sm font-bold">
                    {s.paused ? '⏸ ' : ''}
                    {seriesTitle(s.template, {
                      payeeName: s.template.payeeId
                        ? payeesById.get(s.template.payeeId)
                        : undefined,
                      categoryName: s.template.categoryId
                        ? categoriesById.get(s.template.categoryId)
                        : undefined,
                    })}
                    {' · '}
                    {formatMoney(s.template.amount, s.template.currency)}
                  </Text>
                  <Text className="text-muted text-xs mt-0.5">
                    {describeRule(s.rule)} ·{' '}
                    {accountArchived ? 'Paused — account archived' : `Next: ${nextDueLabel(s)}`}
                  </Text>
                </View>
              </View>

              <View className="flex-row" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => togglePause(s)}
                  className="flex-1 flex-row items-center justify-center bg-surfaceAlt rounded-lg py-2.5"
                  style={{ gap: 6 }}
                  accessibilityLabel={s.paused ? 'Resume series' : 'Pause series'}
                >
                  <Feather
                    name={s.paused ? 'play' : 'pause'}
                    size={13}
                    color={c.muted}
                  />
                  <Text className="text-text text-[13px] font-semibold">
                    {s.paused ? 'Resume' : 'Pause'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => onSkipNext(s)}
                  className="flex-1 flex-row items-center justify-center bg-surfaceAlt rounded-lg py-2.5"
                  style={{ gap: 6 }}
                  accessibilityLabel="Skip next occurrence"
                >
                  <Feather name="skip-forward" size={13} color={c.muted} />
                  <Text className="text-text text-[13px] font-semibold">Skip next</Text>
                </Pressable>

                <Pressable
                  onPress={() => onEdit(s)}
                  className="w-10 h-10 items-center justify-center bg-surfaceAlt rounded-lg"
                  accessibilityLabel="Edit series"
                >
                  <Feather name="edit-2" size={14} color={c.muted} />
                </Pressable>

                <Pressable
                  onPress={() => onDelete(s)}
                  className="w-10 h-10 items-center justify-center bg-deleteChipBg rounded-lg"
                  accessibilityLabel="Delete series"
                >
                  <Feather name="trash-2" size={14} color={c.deleteIcon} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* Editing a series reuses the transaction form: a series template IS
          transaction-shaped, and the form already owns the keypad, the
          account/category/payee pickers and the Repeat row. Its date row
          doubles as the split point — "apply from this occurrence on".
          mode="add" (not "edit") because the form hides Repeat in edit
          mode, and the schedule is the main thing being changed here. */}
      {editing && editInitial && (
        <TransactionFormSheet
          visible
          onClose={() => { setEditing(null); setEditInitial(null); setEditError(null); }}
          title="Edit repeating"
          mode="add"
          accounts={accounts}
          categories={categories}
          payees={payees}
          currency={currency}
          showRepeat
          initial={editInitial}
          onSave={onEditSave}
          busy={editBusy}
          error={editError}
        />
      )}
    </View>
  );
}
