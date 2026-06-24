import React, { createContext, useContext, useState } from 'react';
import {
  PeriodSelection,
  currentMonthSelection,
} from '../components/ui/PeriodSheet';

interface PeriodContextValue {
  sel: PeriodSelection;
  setSel: (next: PeriodSelection) => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<PeriodSelection>(() => currentMonthSelection());
  return (
    <PeriodContext.Provider value={{ sel, setSel }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used inside PeriodProvider');
  return ctx;
}
