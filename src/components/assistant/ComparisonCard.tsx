/**
 * Ask-Xavier answer card — a multi-period COMPARISON chart (docs/design/
 * ask-xavier-queries-spec.md §5.4) — device bug (build 58): a BYOK
 * multi-call comparison ("compare my spending in 2025 vs 2026") used to
 * render as a single `StatCard` for the LAST call only (see
 * `app/(tabs)/index.tsx`'s former "v1 limitation" comment); the comparison
 * survived only in the model's own (untrusted, display-only) narration
 * text. `src/domain/queryComparison.ts`'s `buildQueryComparison` now
 * detects that shape from the already-executed tool calls, and this card
 * renders it as one bar per period instead — every bar and its label built
 * straight from the tool results, never from the narration.
 *
 * Reuses the SAME `BarChart` the dashboard's cash-flow slide already uses
 * (`src/components/ui/BarChart.tsx`) rather than a new chart primitive —
 * its income/expense-bucket shape maps naturally onto "spend" (red,
 * expense side) vs "income" (green, income side) comparisons; a net-worth
 * comparison picks a side PER ENTRY by sign, mirroring `StatCard`'s own
 * sign-based tone for a single net-worth value.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { BarChart, CashFlowBucket } from '../ui/BarChart';
import { formatMoney } from '../../domain/money';
import { QueryComparison } from '../../domain/queryComparison';

/** Map a comparison's series onto `BarChart`'s income/expense bucket shape
 *  — one bucket per series entry, index-keyed so every entry (including a
 *  zero amount) gets its own x-slot regardless of magnitude. */
function bucketsFor(comparison: QueryComparison): CashFlowBucket[] {
  return comparison.series.map((entry, i) => {
    if (comparison.tool === 'total_income') {
      return { start: i, income: entry.amountMinor, expense: 0 };
    }
    if (comparison.tool === 'total_spent') {
      return { start: i, income: 0, expense: entry.amountMinor };
    }
    // net_worth: side chosen per-entry by sign — a negative net worth reads
    // as the "expense"/red side, mirroring StatCard's own sign-based tone.
    return entry.amountMinor >= 0
      ? { start: i, income: entry.amountMinor, expense: 0 }
      : { start: i, income: 0, expense: Math.abs(entry.amountMinor) };
  });
}

export function ComparisonCard({
  comparison,
  currency,
}: {
  comparison: QueryComparison;
  currency: string;
}) {
  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-muted text-xs font-semibold">{comparison.title}</Text>
      <View className="mt-2">
        <BarChart data={bucketsFor(comparison)} />
      </View>
      <View className="flex-row flex-wrap mt-2" style={{ gap: 14 }}>
        {comparison.series.map((entry, i) => (
          <View key={i}>
            <Text className="text-muted text-[10px]">{entry.label}</Text>
            <Text className="text-text text-xs font-semibold">
              {formatMoney(entry.amountMinor, currency)}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
