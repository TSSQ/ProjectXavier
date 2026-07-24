/**
 * Ask-Xavier answer card — a trend line (docs/design/ask-xavier-queries-
 * spec.md §5.4). Feeds `spending_over_time`/`net_worth` (series) tool
 * results into the SAME `MultiLineChart` the dashboard already uses. Only
 * ever one line (the tool results are a single series); every value comes
 * straight from the tool result.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { MultiLineChart } from '../ui/MultiLineChart';
import { formatMoney } from '../../domain/money';
import { useThemeColors } from '../../theme/useThemeColors';
import { SeriesPoint } from '../../domain/queryTools';

export function TrendCard({
  series,
  currency,
  tone = 'neutral',
}: {
  series: SeriesPoint[];
  currency: string;
  /** Line color: 'neutral' (theme primary), or a positive/negative tint for
   *  a net-worth line whose overall direction is worth signalling. */
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const c = useThemeColors();
  if (series.length < 2) {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-muted text-sm">Not enough data in that period yet.</Text>
      </Card>
    );
  }

  const color = tone === 'positive' ? c.positive : tone === 'negative' ? c.negative : c.primary;
  const first = series[0]!;
  const last = series[series.length - 1]!;

  return (
    <Card className="border-borderAccent self-stretch">
      <MultiLineChart series={[{ color, values: series.map((p) => p.amountMinor) }]} />
      <View className="flex-row items-center justify-between mt-2">
        <View>
          <Text className="text-muted text-[10px]">{first.label}</Text>
          <Text className="text-text text-xs font-semibold">{formatMoney(first.amountMinor, currency)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text className="text-muted text-[10px]">{last.label}</Text>
          <Text className="text-text text-xs font-semibold">{formatMoney(last.amountMinor, currency)}</Text>
        </View>
      </View>
    </Card>
  );
}
