/**
 * Pure helpers for parse diagnostics (see docs/design/parse-metrics-spec.md).
 *
 * Framework-free and side-effect-free so the bucketing and material-edit rules
 * are exhaustively BDD-tested in plain Node. The DB writes that use these live
 * in src/features/diagnostics; the capture points live in the screens.
 *
 * Everything here is content-free by construction: inputs are compared and
 * reduced to booleans / small integer buckets — no names, amounts, or dates are
 * returned or stored.
 */
import { TransactionType } from './types';
import { normalizeName, editDistance, fuzzyThreshold } from './payees';
import { isSameDay } from './dates';

/** Self-rated AI confidence (0..1) → bucket 0..4. Null passes through. */
export function confidenceBucket(c: number | null | undefined): number | null {
  if (typeof c !== 'number' || Number.isNaN(c)) return null;
  return Math.min(4, Math.max(0, Math.floor(c * 5)));
}

export type LenBucket = 'xs' | 's' | 'm' | 'l';

/** Coarse input-length bucket (never the raw length). */
export function inputLenBucket(len: number): LenBucket {
  if (len < 20) return 'xs';
  if (len < 60) return 's';
  if (len < 160) return 'm';
  return 'l';
}

/**
 * Percentage-delta bucket between a pre-edit and post-edit amount (minor units).
 * Content-free: a relative magnitude, never the value itself.
 *   0 ≤1%   1 ≤10%   2 ≤25%   3 ≤50%   4 >50%
 */
export function amountDeltaBucket(before: number, after: number): number {
  const pct = Math.abs(after - before) / Math.max(Math.abs(before), 1);
  if (pct <= 0.01) return 0;
  if (pct <= 0.1) return 1;
  if (pct <= 0.25) return 2;
  if (pct <= 0.5) return 3;
  return 4;
}

/** Amount changed by more than rounding noise (>1% relative). */
export function isAmountMaterial(before: number, after: number): boolean {
  return amountDeltaBucket(before, after) > 0;
}

/**
 * A name field (payee/category) was *materially* changed — i.e. swapped for a
 * genuinely different value, not just a near-typo correction. Adding or removing
 * a name entirely counts as material.
 */
export function isNameMaterial(
  before: string | null | undefined,
  after: string | null | undefined
): boolean {
  const a = before ? normalizeName(before) : '';
  const b = after ? normalizeName(after) : '';
  if (a === b) return false;
  if (!a || !b) return true; // added or removed
  const dist = editDistance(a, b);
  return dist > fuzzyThreshold(Math.max(a.length, b.length));
}

/** Date changed to a different calendar day. */
export function isDateMaterial(before: number, after: number): boolean {
  return !isSameDay(before, after);
}

/** The editable fields of a transaction, as the parse proposed / the user saved. */
export interface EditableSnapshot {
  amount: number; // minor units
  type: TransactionType;
  payeeName: string | null;
  categoryName: string | null;
  occurredAt: number;
}

export interface MaterialEdit {
  editedAmount: boolean;
  editedType: boolean;
  editedPayee: boolean;
  editedCategory: boolean;
  editedDate: boolean;
  /** Percentage-delta bucket for the amount (0 when not materially changed). */
  amountDeltaBucket: number;
  /** True if any tracked field was materially edited. */
  any: boolean;
}

/** Compare what the parse proposed against what the user ultimately saved. */
export function compareEdit(
  before: EditableSnapshot,
  after: EditableSnapshot
): MaterialEdit {
  const editedAmount = isAmountMaterial(before.amount, after.amount);
  const editedType = before.type !== after.type;
  const editedPayee = isNameMaterial(before.payeeName, after.payeeName);
  const editedCategory = isNameMaterial(before.categoryName, after.categoryName);
  const editedDate = isDateMaterial(before.occurredAt, after.occurredAt);
  return {
    editedAmount,
    editedType,
    editedPayee,
    editedCategory,
    editedDate,
    amountDeltaBucket: amountDeltaBucket(before.amount, after.amount),
    any: editedAmount || editedType || editedPayee || editedCategory || editedDate,
  };
}
