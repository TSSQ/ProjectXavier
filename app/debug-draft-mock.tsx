/**
 * Draft card — inline defaults mockup. Test-build only, visual prototype.
 *
 * Shows a proposed treatment for the assistant draft card where fields the
 * parser *guessed/defaulted* render as distinct, tappable pills, versus
 * fields *parsed* from the user's words which render as plain rows. This is
 * a throwaway, self-contained screen to eyeball the look before wiring it
 * into the real flow — it does NOT touch parsing, interpret(), or the
 * production DraftCard/Field in app/(tabs)/index.tsx.
 *
 * Reached from a hidden Settings → Developer row that only appears when
 * METRICS_ENABLED, same as debug-fm.tsx. Also directly routable via the
 * deep link projectxavier://debug-draft-mock.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../src/components/ui/Card';
import { Button } from '../src/components/ui/Button';
import { useThemeColors } from '../src/theme/useThemeColors';

/** One row's worth of mock draft data: a label, a value, and whether the
 *  value was parsed from the user's words (plain row) or guessed/defaulted
 *  by the parser (tappable pill). */
interface MockField {
  label: string;
  value: string;
  defaulted: boolean;
}

interface MockDraft {
  caption: string;
  type: string;
  source: 'On-device' | 'AI parsed' | 'Offline';
  amount: string;
  account: MockField;
  payee: MockField;
  category: MockField;
  date: MockField;
}

const SAMPLES: MockDraft[] = [
  {
    caption: 'Clean — all parsed',
    type: 'expense',
    source: 'On-device',
    amount: '-SGD 12.50',
    account: { label: 'Account', value: 'Amex', defaulted: false },
    payee: { label: 'Payee', value: 'Starbucks', defaulted: false },
    category: { label: 'Category', value: 'Dining', defaulted: false },
    date: { label: 'Date', value: 'Yesterday', defaulted: false },
  },
  {
    caption: 'Some guesses',
    type: 'expense',
    source: 'On-device',
    amount: '-SGD 10.00',
    account: { label: 'Account', value: 'Budget', defaulted: true },
    payee: { label: 'Payee', value: "McDonald's", defaulted: false },
    category: { label: 'Category', value: 'Food', defaulted: true },
    date: { label: 'Date', value: 'Today', defaulted: true },
  },
  {
    caption: 'Sparse — mostly guessed',
    type: 'expense',
    source: 'On-device',
    amount: '-SGD 45.00',
    account: { label: 'Account', value: 'Budget', defaulted: true },
    payee: { label: 'Payee', value: '—', defaulted: true },
    category: { label: 'Category', value: 'Uncategorized', defaulted: true },
    date: { label: 'Date', value: 'Today', defaulted: true },
  },
];

export default function DebugDraftMockScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back" className="flex-row items-center">
            <Feather name="chevron-left" size={24} color={c.muted} />
            <Text className="text-muted text-base ml-1">Back</Text>
          </Pressable>
        </View>

        <Text className="text-text text-[24px] font-extrabold mb-1">
          Draft card — inline defaults (mockup)
        </Text>
        <Text className="text-muted text-xs mb-4">
          Test-build mockup · visual prototype only, no parsing logic wired up.
        </Text>

        {SAMPLES.map((sample) => (
          <View key={sample.caption} className="mb-6">
            <Text className="text-muted text-[10px] font-bold uppercase mb-2">
              {sample.caption}
            </Text>
            <MockDraftCard draft={sample} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function MockDraftCard({ draft }: { draft: MockDraft }) {
  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text text-sm font-bold capitalize">{draft.type}</Text>
        <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
          {draft.source}
        </Text>
      </View>
      <PlainField label="Amount" value={draft.amount} valueClassName="text-negative" />
      <MockFieldRow field={draft.account} />
      <MockFieldRow field={draft.payee} />
      <MockFieldRow field={draft.category} />
      <MockFieldRow field={draft.date} />

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={() => {}} className="flex-1" />
        <Button title="Edit" variant="ghost" onPress={() => {}} className="flex-1" />
        <Button title="Save" variant="primary" onPress={() => {}} className="flex-1" />
      </View>
    </Card>
  );
}

function MockFieldRow({ field }: { field: MockField }) {
  return field.defaulted ? (
    <DefaultedField field={field} />
  ) : (
    <PlainField label={field.label} value={field.value} />
  );
}

function PlainField({
  label,
  value,
  valueClassName = 'text-text',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-muted text-[13px]">{label}</Text>
      <Text className={`text-[13px] font-semibold ${valueClassName}`}>{value}</Text>
    </View>
  );
}

function DefaultedField({ field }: { field: MockField }) {
  const c = useThemeColors();
  const onPress = () =>
    Alert.alert('Mockup', `Would open the ${field.label} picker`);

  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-muted text-[13px]">{field.label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${field.label}: guessed, tap to change`}
        className="flex-row items-center rounded-pill border border-amber px-2 py-0.5"
        style={{ gap: 4 }}
      >
        <Text className="text-amber text-[13px] font-semibold">{field.value}</Text>
        <Feather name="chevron-right" size={14} color={c.amber} />
      </Pressable>
    </View>
  );
}
