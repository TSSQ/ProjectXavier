/**
 * The budget edit sheet (monthly-budgets spec §5.3): the keypad sheet with the
 * category as its title, the 3-month-average hint, an "Applies to" scope
 * (this month only / this month onward, onward by default) and, when a budget
 * exists, "Remove budget" in the negative colour. "Done" with 0 means Remove.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { KeypadSheet } from '../ui/KeypadSheet';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useThemeColors } from '../../theme/useThemeColors';
import { BudgetScope, MonthKey, monthName } from '../../domain/budgets';
import { formatBudgetMoney } from '../../domain/budgetCopy';

export interface BudgetEditTarget {
  categoryId: string;
  name: string;
  icon: string | null;
  /** Current budget for the month, minor units; null when none. */
  current: number | null;
  /** Value to seed the keypad with when there is no budget (e.g. the afford
   *  flow's "budget + overage"); defaults to the current budget. */
  seed?: number;
  /** 3-month average, minor units; 0/undefined hides the hint. */
  average?: number;
}

export function BudgetEditSheet({
  visible,
  target,
  month,
  currency,
  onClose,
  onSave,
}: {
  visible: boolean;
  target: BudgetEditTarget | null;
  month: MonthKey;
  currency: string;
  onClose: () => void;
  /** `amount` null = remove the budget. */
  onSave: (categoryId: string, amount: number | null, scope: BudgetScope) => Promise<void>;
}) {
  const c = useThemeColors();
  const [scope, setScope] = useState<BudgetScope>('onward');
  // Keep the last target while the sheet slides away, so closing does not
  // unmount it mid-animation.
  const [kept, setKept] = useState<BudgetEditTarget | null>(target);
  useEffect(() => {
    if (target) setKept(target);
  }, [target]);
  const shown = target ?? kept;
  // Onward is the default every time the sheet opens: most budgets do not
  // change month to month.
  useEffect(() => {
    if (visible) setScope('onward');
  }, [visible, target?.categoryId]);

  if (!shown) return null;
  const t = shown;
  const month_ = monthName(month);
  const labels: Record<BudgetScope, string> = {
    month: `${month_} only`,
    onward: `${month_} onward`,
  };

  const save = (minor: number) => {
    if (minor <= 0) {
      // Done with nothing is Remove — and a no-op when there was no budget.
      if (t.current !== null) void onSave(t.categoryId, null, scope);
      return;
    }
    void onSave(t.categoryId, minor, scope);
  };

  return (
    <KeypadSheet
      visible={visible}
      onClose={onClose}
      title={`${t.icon ?? '🏷️'} ${t.name}`}
      currency={currency}
      initialMinor={t.seed ?? t.current ?? 0}
      onDone={save}
      doneInHeader
      detail={
        <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
          {!!t.average && t.average > 0 && (
            <Text className="text-muted text-[12px] text-center">
              You averaged {formatBudgetMoney(t.average, currency)} over the last 3 months
            </Text>
          )}
          <Text className="text-muted text-[12px] font-bold uppercase tracking-wide mt-3 mb-1.5">
            Applies to
          </Text>
          <SegmentedControl
            options={['month', 'onward'] as const}
            value={scope}
            onChange={setScope}
            labels={labels}
          />
        </View>
      }
      footerBelow={
        t.current !== null ? (
          <Pressable
            onPress={() => {
              void onSave(t.categoryId, null, scope);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove budget"
            className="items-center"
            style={{ paddingTop: 12, paddingBottom: 4 }}
            hitSlop={8}
          >
            <Text style={{ color: c.negative, fontSize: 14, fontWeight: '600' }}>Remove budget</Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}
