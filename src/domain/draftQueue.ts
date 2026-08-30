/**
 * Batch draft review — the state behind "scan six receipts, confirm them one
 * card at a time". Pure and framework-free, so the awkward parts (progress
 * arithmetic, what "done" means, what the last card does) are covered by the
 * Node suite rather than only by tapping through a device.
 *
 * Two phases share one progress shape:
 *   1. PARSING  — N photos become N drafts, ~2.4s each, so the bar is the
 *                 difference between "the app is working" and "the app hung".
 *   2. REVIEW   — the user accepts or skips each draft in turn.
 */
import { TransactionDraft } from './assistant';

export interface BatchProgress {
  /** 0..1, clamped. Safe to hand straight to a progress bar's width. */
  fraction: number;
  /** "3 of 6" — the count the user is actually tracking. */
  label: string;
  done: boolean;
}

/**
 * Progress through `total` items with `completed` finished.
 *
 * A zero-length batch is `done` with a full bar, not an empty one: a bar that
 * sits at 0% while nothing is happening reads as stuck. Both arguments are
 * clamped, because a caller that double-counts a completion should render a
 * full bar rather than one overflowing its track.
 */
export function batchProgress(completed: number, total: number): BatchProgress {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeDone = Math.min(Math.max(0, Math.trunc(completed)), safeTotal);
  if (safeTotal === 0) return { fraction: 1, label: '0 of 0', done: true };
  return {
    fraction: safeDone / safeTotal,
    label: `${safeDone} of ${safeTotal}`,
    done: safeDone >= safeTotal,
  };
}

/** A decision the user made about one draft. */
export type DraftDecision = 'saved' | 'skipped';

export interface DraftQueue {
  drafts: TransactionDraft[];
  /** Index of the card being shown. Equals drafts.length once finished. */
  index: number;
  /** One entry per decided draft, in order. Length === index. */
  decisions: DraftDecision[];
}

export function startQueue(drafts: TransactionDraft[]): DraftQueue {
  return { drafts, index: 0, decisions: [] };
}

/** The card to render, or null when the queue is finished. */
export function currentDraft(q: DraftQueue): TransactionDraft | null {
  return q.index < q.drafts.length ? q.drafts[q.index]! : null;
}

export function queueDone(q: DraftQueue): boolean {
  return q.index >= q.drafts.length;
}

/**
 * Record a decision and move to the next card.
 *
 * Advancing past the end is a no-op rather than an error: the save path is
 * async, so a double-tap on the last card's Save can easily arrive twice, and
 * the second one must not push `index` beyond `drafts.length` and make
 * `decisions` disagree with it.
 */
export function decideCurrent(q: DraftQueue, decision: DraftDecision): DraftQueue {
  if (queueDone(q)) return q;
  return { ...q, index: q.index + 1, decisions: [...q.decisions, decision] };
}

/** How the batch ended, for the closing summary line. */
export function queueSummary(q: DraftQueue): { saved: number; skipped: number } {
  return {
    saved: q.decisions.filter((d) => d === 'saved').length,
    skipped: q.decisions.filter((d) => d === 'skipped').length,
  };
}

/** Review progress, shaped for the same bar the parsing phase uses. */
export function reviewProgress(q: DraftQueue): BatchProgress {
  return batchProgress(q.index, q.drafts.length);
}
