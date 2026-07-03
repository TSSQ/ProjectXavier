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

// ── aggregate() — pure reduction of parse-metric rows ─────────────────────
// Lives here (not in src/features/) so the BDD suite can import it without
// pulling in the Drizzle/expo-sqlite DB client.

/** The subset of a parse_metrics row that aggregate() reads. */
export interface AggregateRow {
  engine: string;
  outcome: string;
  resolved: string | null;
  payeeSwapped: number | null;
  confidenceBucket: number | null;
  latencyMs: number | null;
  edited: number | null;
  editedAmount: number | null;
  editedType: number | null;
  editedPayee: number | null;
  editedCategory: number | null;
  editedDate: number | null;
}

export interface MetricsAggregate {
  total: number;
  byEngine: Record<string, number>;
  byOutcome: Record<string, number>;
  saved: number;
  discarded: number;
  clarifyRate: number; // share of parses that asked to clarify
  payeeSwapped: number;
  edited: number;
  editedByField: {
    amount: number;
    type: number;
    payee: number;
    category: number;
    date: number;
  };
  /** Material-edit rate among *saved* AI transactions (the key L2 signal). */
  materialEditRate: number;
  /** Parses where the user corrected the draft before saving (resolved='edited'). */
  editedAtDraft: number;
  medianLatencyMs: number | null;
  confidenceHistogram: number[]; // index 0..4
}

/** Reduce the raw rows to the headline numbers the debug screen shows. */
export function aggregate(rows: AggregateRow[]): MetricsAggregate {
  const inc = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  const byEngine: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const confidenceHistogram = [0, 0, 0, 0, 0];
  const latencies: number[] = [];
  let saved = 0;
  let discarded = 0;
  let clarify = 0;
  let payeeSwapped = 0;
  let edited = 0;
  let editedMaterial = 0;
  let editedAtDraft = 0;
  const editedByField = { amount: 0, type: 0, payee: 0, category: 0, date: 0 };

  for (const r of rows) {
    inc(byEngine, r.engine);
    inc(byOutcome, r.outcome);
    if (r.outcome === 'clarify_missing' || r.outcome === 'clarify_lowconf') clarify++;
    if (r.resolved === 'saved' || r.resolved === 'edited') saved++;
    if (r.resolved === 'discarded') discarded++;
    if (r.resolved === 'edited') editedAtDraft++;
    if (r.payeeSwapped) payeeSwapped++;
    if (typeof r.confidenceBucket === 'number') {
      const b = Math.min(4, Math.max(0, r.confidenceBucket));
      confidenceHistogram[b] = (confidenceHistogram[b] ?? 0) + 1;
    }
    if (typeof r.latencyMs === 'number') latencies.push(r.latencyMs);
    if (r.edited) {
      edited++;
      const fieldHit =
        r.editedAmount || r.editedType || r.editedPayee || r.editedCategory || r.editedDate;
      if (fieldHit) editedMaterial++;
      if (r.editedAmount) editedByField.amount++;
      if (r.editedType) editedByField.type++;
      if (r.editedPayee) editedByField.payee++;
      if (r.editedCategory) editedByField.category++;
      if (r.editedDate) editedByField.date++;
    }
  }

  latencies.sort((a, b) => a - b);
  const medianLatencyMs = latencies.length
    ? latencies[Math.floor((latencies.length - 1) / 2)]!
    : null;

  return {
    total: rows.length,
    byEngine,
    byOutcome,
    saved,
    discarded,
    clarifyRate: rows.length ? clarify / rows.length : 0,
    payeeSwapped,
    edited,
    editedByField,
    materialEditRate: saved ? editedMaterial / saved : 0,
    editedAtDraft,
    medianLatencyMs,
    confidenceHistogram,
  };
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
