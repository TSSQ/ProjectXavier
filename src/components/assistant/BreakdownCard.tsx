/**
 * Ask-Xavier answer card — spending-by-category breakdown
 * (docs/design/ask-xavier-queries-spec.md §5.4). Feeds `spending_by_category`
 * tool results into the SAME `DonutChart` the dashboard already uses, plus a
 * text legend — every slice value comes straight from the tool result.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { DonutChart } from '../ui/DonutChart';
import { formatMoney } from '../../domain/money';
import { useThemeColors } from '../../theme/useThemeColors';
import { CategorySlice } from '../../domain/queryTools';

/** A small fixed palette, cycled — mirrors the dashboard's own category-
 *  breakdown card (no per-category color storage in the domain model). */
const SLICE_COLORS = ['#6366F1', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6'];

export function BreakdownCard({
  slices,
  currency,
}: {
  slices: CategorySlice[];
  currency: string;
}) {
  const c = useThemeColors();
  if (slices.length === 0) {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-muted text-sm">No spending in that period.</Text>
      </Card>
    );
  }

  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center" style={{ gap: 16 }}>
        <DonutChart
          slices={slices.map((s, i) => ({ value: s.amountMinor, color: SLICE_COLORS[i % SLICE_COLORS.length]! }))}
        />
        <View className="flex-1" style={{ gap: 6 }}>
          {slices.slice(0, 6).map((s, i) => (
            <View key={s.categoryId ?? 'uncategorized'} className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-shrink" style={{ gap: 6 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length],
                  }}
                />
                <Text className="text-text text-xs flex-shrink" numberOfLines={1}>
                  {s.name}
                </Text>
              </View>
              <Text className="text-muted text-xs font-semibold ml-2" style={{ color: c.muted }}>
                {formatMoney(s.amountMinor, currency)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}
