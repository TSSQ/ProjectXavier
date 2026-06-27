/**
 * Avatar-evolution progression — wires net worth to the pure stage mechanic
 * (src/domain/evolution.ts) and persists the baseline + high-water mark.
 *
 * Rules (ADR 0004):
 *  - Baseline net worth is captured the first time progression runs with at
 *    least one active account present.
 *  - Growth = current net worth − baseline.
 *  - High-water = max growth ever seen; the stage derives from it and never
 *    decreases (no devolve).
 */
import { Account, Transaction } from '../../domain/types';
import { netWorth } from '../../domain/balances';
import { progressToNext, EvolutionProgress } from '../../domain/evolution';
import { listAccounts } from '../accounts/repository';
import { listTransactions } from '../transactions/repository';
import {
  getProgressionBaseline,
  setProgressionBaseline,
  getProgressionHighWater,
  setProgressionHighWater,
} from '../settings/repository';

export interface ProgressionSnapshot extends EvolutionProgress {
  /** High-water growth over baseline (minor units) — what drives the stage. */
  growth: number;
  /** Current net worth (minor units). */
  netWorth: number;
}

/**
 * Recompute progression and persist any advance. Pass already-loaded data to
 * avoid re-querying (the assistant screen already holds accounts/transactions).
 */
export async function refreshProgression(preloaded?: {
  accounts: Account[];
  transactions: Transaction[];
}): Promise<ProgressionSnapshot> {
  const accounts = preloaded?.accounts ?? (await listAccounts());
  const transactions = preloaded?.transactions ?? (await listTransactions());
  const active = accounts.filter((a) => !a.archived);
  const nw = netWorth(accounts, transactions);

  let baseline = await getProgressionBaseline();
  if (baseline == null) {
    // No accounts yet → no meaningful baseline; stay at stage 0 without
    // persisting (so the baseline is captured once real data exists).
    if (active.length === 0) {
      return { ...progressToNext(0), growth: 0, netWorth: nw };
    }
    baseline = nw;
    await setProgressionBaseline(baseline);
  }

  const growthNow = nw - baseline;
  let highWater = await getProgressionHighWater();
  if (growthNow > highWater) {
    highWater = growthNow;
    await setProgressionHighWater(highWater);
  }

  return { ...progressToNext(highWater), growth: highWater, netWorth: nw };
}
