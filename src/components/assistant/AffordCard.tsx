/**
 * The "can I afford it?" answer card (monthly-budgets spec §6.2, mockup §2):
 * the category and month with a Fits / Over chip, a thick bar with a ghost
 * segment for the purchase (clamped at 100% with a cap line when over) and the
 * Today tick, "spent · budget", then Left now / After this. Every number comes
 * from the plan (src/domain/affordPlan.ts), never from model prose.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '../ui/Card';
import { BudgetBar } from '../ui/BudgetBar';
import { StatusChip } from '../ui/StatusChip';
import { useThemeColors } from '../../theme/useThemeColors';
import { BudgetSummary, monthLabel } from '../../domain/budgets';
import { formatBudgetMoney } from '../../domain/budgetCopy';
import type { AffordPlan } from '../../domain/affordPlan';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function AffordCard({
  plan,
  summary,
  currency,
  now,
}: {
  plan: Extract<AffordPlan, { kind: 'answer' }>;
  summary: BudgetSummary;
  currency: string;
  /** The clock, so a month in another year carries its year. */
  now: number;
}) {
  const c = useThemeColors();
  const { result, view } = plan;
  const over = result.verdict === 'over';
  // "All budgets" draws the month's totals; a category draws its own figures.
  const budget = view?.budget ?? summary.budget;
  const spent = view?.spent ?? summary.spent;
  const scheduled = view?.scheduled ?? summary.scheduled;
  const state = view?.state ?? (summary.left < 0 ? 'over' : 'ok');
  const tick = view ? view.tick : summary.tick;
  const money = (n: number) => formatBudgetMoney(n, currency);
  const label = `${plan.icon ? `${plan.icon} ` : ''}${plan.categoryName ?? 'All budgets'} · ${monthLabel(plan.month, now, true)}`;
  const after = result.after;

  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text numberOfLines={1} className="text-muted text-[12px] font-bold uppercase tracking-wide flex-1">
          {label}
        </Text>
        <StatusChip label={over ? 'Over' : 'Fits'} tone={over ? 'over' : 'ok'} />
      </View>
      <BudgetBar
        budget={budget}
        spent={spent}
        scheduled={scheduled}
        state={state}
        tick={over ? null : tick}
        ghost={{ amount: plan.amount, over }}
        style={{ marginTop: 12 }}
      />
      <View className="flex-row justify-between" style={{ marginTop: 5 }}>
        <Text className="text-muted text-[11px]" style={TABULAR}>{money(spent)} spent</Text>
        <Text className="text-muted text-[11px]" style={TABULAR}>{money(budget)} budget</Text>
      </View>
      <View className="bg-border my-2" style={{ height: 1 }} />
      <View className="flex-row justify-between items-baseline">
        <Text className="text-muted text-[13px]">Left now</Text>
        <Text className="text-text text-[13px] font-bold" style={TABULAR}>
          {result.leftNow < 0 ? `−${money(-result.leftNow)}` : money(result.leftNow)}
        </Text>
      </View>
      <View className="flex-row justify-between items-baseline" style={{ marginTop: 3 }}>
        <Text className="text-muted text-[13px]">After this</Text>
        <Text
          className="text-[13px] font-bold"
          style={{ ...TABULAR, color: after < 0 ? c.negative : c.positive }}
        >
          {after < 0 ? `−${money(-after)}` : money(after)}
        </Text>
      </View>
      {plan.overall && <Text className="text-muted text-[11px] mt-2">{plan.overall}</Text>}
    </Card>
  );
}
