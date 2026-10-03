/**
 * One budgeted category: icon chip, name, "$X left" / "$X over" in the state's
 * colour, a thin bar, and (on the Budget screen) a detail line. Shared by the
 * dashboard card and the Budget screen so the two cannot drift.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { BudgetBar } from '../ui/BudgetBar';
import { warnColor } from '../ui/StatusChip';
import { useThemeColors } from '../../theme/useThemeColors';
import type { Category } from '../../domain/types';
import type { CategoryBudget } from '../../domain/budgets';
import { categoryDetailLine, leftOrOver } from '../../domain/budgetCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function CategoryIcon({ category }: { category: Pick<Category, 'icon'> | undefined }) {
  return (
    <View className="w-9 h-9 rounded-md bg-badgeFlat items-center justify-center">
      <Text className="text-lg">{category?.icon ?? '🏷️'}</Text>
    </View>
  );
}

export function BudgetCategoryRow({
  view,
  category,
  currency,
  detail = false,
  okTone = 'muted',
  onPress,
}: {
  view: CategoryBudget;
  category: Category | undefined;
  currency: string;
  /** Show the "$412 of $600" / "paid · scheduled" line (Budget screen). */
  detail?: boolean;
  /** Colour of an ok row's "$X left": muted on the dashboard, text on the screen. */
  okTone?: 'muted' | 'text';
  onPress?: () => void;
}) {
  const c = useThemeColors();
  const color =
    view.state === 'over'
      ? c.negative
      : view.state === 'warn'
        ? warnColor(c)
        : okTone === 'text'
          ? c.text
          : c.muted;
  // The tick is meaningless on a full (over) bar and hides under a scheduled
  // segment, so it only shows where it reads.
  const showTick = view.tick !== null && view.state !== 'over' && view.scheduled === 0;
  const name = category?.name ?? 'Category';

  const body = (
    <View className="flex-row items-center" style={{ gap: 10 }}>
      <CategoryIcon category={category} />
      <View className="flex-1">
        <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
          <Text numberOfLines={1} className="text-text text-[14px] font-semibold flex-1">
            {name}
          </Text>
          <Text style={{ ...TABULAR, color, fontSize: 13, fontWeight: '700' }}>
            {leftOrOver(view.left, currency)}
          </Text>
        </View>
        <BudgetBar
          thin
          budget={view.budget}
          spent={view.spent}
          scheduled={view.scheduled}
          state={view.state}
          tick={showTick ? view.tick : null}
        />
        {detail && (
          <Text className="text-muted text-[11px] mt-1" style={TABULAR}>
            {categoryDetailLine(view, currency)}
          </Text>
        )}
      </View>
    </View>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${leftOrOver(view.left, currency)}`}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}
