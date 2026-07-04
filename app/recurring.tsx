/**
 * Recurring series management — list all active recurring series with
 * pause/resume, skip-next, and delete (archive) actions.
 * Navigated to from Dashboard › Manage.
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
import { RecurringSeries } from '../src/domain/types';
import {
  listSeries,
  updateSeries,
  skipNextOccurrence,
} from '../src/features/recurring/repository';
import { upcomingOccurrences, describeRule } from '../src/domain/recurrence';
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

  const refresh = useCallback(async () => {
    const list = await listSeries();
    setSeriesList(list.filter((s) => !s.archived));
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
        renderItem={({ item: s }) => (
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
                  {s.template.type.charAt(0).toUpperCase() + s.template.type.slice(1)}
                  {' · '}
                  {formatMoney(s.template.amount, s.template.currency)}
                </Text>
                <Text className="text-muted text-xs mt-0.5">
                  {describeRule(s.rule)} · Next: {nextDueLabel(s)}
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
                onPress={() => onDelete(s)}
                className="w-10 h-10 items-center justify-center bg-deleteChipBg rounded-lg"
                accessibilityLabel="Delete series"
              >
                <Feather name="trash-2" size={14} color={c.deleteIcon} />
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}
