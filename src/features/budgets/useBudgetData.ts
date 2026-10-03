/**
 * Loads everything the Budget screens compute from, and keeps it fresh: on
 * focus when something changed (useFocusReload), and when the app returns to
 * the foreground on a later day. The clock is read here, at the UI boundary,
 * never inside src/domain.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Category, Payee, RecurringSeries, Transaction, Account } from '../../domain/types';
import { BudgetRow } from '../../domain/budgets';
import { isSameDay } from '../../domain/dates';
import { listTransactions } from '../transactions/repository';
import { listSeries } from '../recurring/repository';
import { listCategories } from '../categories/repository';
import { listAccounts } from '../accounts/repository';
import { listPayees } from '../payees/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../settings/repository';
import { listBudgetRows } from './repository';
import { useFocusReload } from '../../lib/useFocusReload';

export interface BudgetData {
  transactions: Transaction[];
  series: RecurringSeries[];
  categories: Category[];
  accounts: Account[];
  payees: Payee[];
  rows: BudgetRow[];
  currency: string;
  now: number;
  loaded: boolean;
}

const EMPTY: BudgetData = {
  transactions: [],
  series: [],
  categories: [],
  accounts: [],
  payees: [],
  rows: [],
  currency: DEFAULT_CURRENCY,
  now: 0,
  loaded: false,
};

export function useBudgetData(): { data: BudgetData; refresh: () => Promise<void> } {
  const [data, setData] = useState<BudgetData>(EMPTY);

  const refresh = useCallback(async () => {
    const [transactions, series, categories, accounts, payees, rows, currency] = await Promise.all([
      listTransactions(),
      listSeries(),
      listCategories(),
      listAccounts(),
      listPayees(),
      listBudgetRows(),
      getCurrency(),
    ]);
    setData({
      transactions,
      series: series.filter((s) => !s.archived),
      categories,
      accounts,
      payees,
      rows,
      currency,
      now: Date.now(),
      loaded: true,
    });
  }, []);

  useFocusReload(refresh);

  // Back from the background on a later day: move the clock on.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const t = Date.now();
      setData((prev) => (prev.loaded && !isSameDay(prev.now, t) ? { ...prev, now: t } : prev));
    });
    return () => sub.remove();
  }, []);

  return { data, refresh };
}
