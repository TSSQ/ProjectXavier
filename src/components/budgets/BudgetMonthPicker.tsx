/**
 * The Budget screens' header month control: the Dashboard's glass period pill
 * opening a month-only PeriodSheet. The list offers every month with activity
 * plus the current, next and selected months (budgets can be set ahead).
 */
import React, { useMemo, useState } from 'react';
import { PeriodPill } from '../ui/PeriodPill';
import { PeriodSheet, monthLabel } from '../ui/PeriodSheet';
import { PeriodMode } from '../ui/PeriodSheet';
import { Transaction } from '../../domain/types';
import { BudgetRow, MonthKey, budgetExtraMonthStarts, monthKeyOf, monthStart } from '../../domain/budgets';

const MONTH_ONLY: PeriodMode[] = ['month'];

export function BudgetMonthPicker({
  month,
  now,
  transactions,
  budgetRows,
  currency,
  onChange,
}: {
  month: MonthKey;
  now: number;
  transactions: Transaction[];
  /** Stored budget rows — their months are offered even if empty. */
  budgetRows: BudgetRow[];
  currency: string;
  onChange: (next: MonthKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const extra = useMemo(() => budgetExtraMonthStarts(now, month, budgetRows), [now, month, budgetRows]);
  return (
    <>
      <PeriodPill label={monthLabel(monthStart(month))} onPress={() => setOpen(true)} a11yLabel="Change month" />
      <PeriodSheet
        visible={open}
        initialMode="month"
        modes={MONTH_ONLY}
        extraMonthStarts={extra}
        selectedStart={monthStart(month)}
        transactions={transactions}
        currency={currency}
        onSelect={(sel) => {
          onChange(monthKeyOf(sel.start));
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
