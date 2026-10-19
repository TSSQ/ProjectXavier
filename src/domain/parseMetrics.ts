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
import type { NotTransactionCue } from './notTransactionCues';
import type { CloudParseFailure } from './cloudParseTransport';
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

/** The `groundingCounts` detail written on the row of the engine that took over
 *  after the on-device tier failed: `{"fmFallback":"threw"}`. Content-free (a
 *  fixed enum), so `fmFallbackCounts` can read the throw rate back. Written
 *  only on the heuristic engine's row (the engine that takes over after a
 *  failed on-device tier), not on rows of any other engine. */
export function fmFallbackDetail(reason: string): string {
  return JSON.stringify({ fmFallback: reason });
}

/** The `groundingCounts` detail written on a `refused` row when the cue check
 *  (src/domain/notTransactionCues.ts) refused before the model ran:
 *  `{"notTransactionCue":"should-i"}`. A fixed enum, so content-free. The model's
 *  own refusals carry no detail. `fmFallbackCounts` ignores it (other key). */
export function notTransactionCueDetail(cue: NotTransactionCue): string {
  return JSON.stringify({ notTransactionCue: cue });
}

/** The `groundingCounts` detail written on the BYOK engine's own row when the
 *  user's cloud key produced nothing (`outcome: 'error'`, engine 'openai' |
 *  'anthropic'): `{"cloudFailure":"auth"}`. A fixed enum
 *  (src/domain/cloudParseTransport.ts's `CloudParseFailure`), so content-free
 *  — never the status line, header, or body. `fmFallbackCounts` ignores it
 *  (other key). */
export function cloudFailureDetail(reason: CloudParseFailure): string {
  return JSON.stringify({ cloudFailure: reason });
}

/** What phrase memory (src/domain/phraseMemory.ts) did on a parse:
 *  `applied` = remembered fields were put on the draft, `forced_log` = a
 *  'log' verdict overrode a refusal, `kept_refusal` = a 'not_log' verdict
 *  kept a refusal code would have affirmed. A fixed enum — never the key. */
export type PhraseMemoryMetric = 'applied' | 'forced_log' | 'kept_refusal';

/** `base` (another detail, or null) with `{"phraseMemory": kind}` merged in. */
export function phraseMemoryDetail(kind: PhraseMemoryMetric, base: string | null = null): string {
  let merged: Record<string, unknown> = {};
  if (base) {
    try {
      const parsed: unknown = JSON.parse(base);
      if (parsed && typeof parsed === 'object') merged = { ...(parsed as Record<string, unknown>) };
    } catch {
      // not JSON: replaced
    }
  }
  return JSON.stringify({ ...merged, phraseMemory: kind });
}

/** The `phraseMemory` value in a row's detail, if any. */
export function phraseMemoryOf(groundingCounts: string | null | undefined): PhraseMemoryMetric | null {
  if (!groundingCounts) return null;
  try {
    const v: unknown = (JSON.parse(groundingCounts) as { phraseMemory?: unknown }).phraseMemory;
    return v === 'applied' || v === 'forced_log' || v === 'kept_refusal' ? v : null;
  } catch {
    return null;
  }
}

/** How often each BYOK failure reason was logged, over parse-metric rows —
 *  the `cloudFailureDetail` counterpart of `fmFallbackCounts`. */
export function cloudFailureCounts(
  rows: ReadonlyArray<{ groundingCounts: string | null }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.groundingCounts) continue;
    try {
      const reason: unknown = (JSON.parse(r.groundingCounts) as { cloudFailure?: unknown }).cloudFailure;
      if (typeof reason === 'string') counts[reason] = (counts[reason] ?? 0) + 1;
    } catch {
      // a row with some other detail in the column
    }
  }
  return counts;
}

/** How often each fallback reason was logged, over parse-metric rows. */
export function fmFallbackCounts(rows: ReadonlyArray<{ groundingCounts: string | null }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.groundingCounts) continue;
    try {
      const reason: unknown = (JSON.parse(r.groundingCounts) as { fmFallback?: unknown }).fmFallback;
      if (typeof reason === 'string') counts[reason] = (counts[reason] ?? 0) + 1;
    } catch {
      // a row with some other detail in the column
    }
  }
  return counts;
}

/** How the user answered a cue refusal (`notTransactionCueDetail` rows):
 *  `overridden` = tapped "Log anyway" (the cue refused a real expense, the
 *  false-refusal signal), `discarded` = accepted the refusal. Rows still open
 *  and rows without the detail are not counted. */
export function notTransactionCueCounts(
  rows: ReadonlyArray<{ groundingCounts?: string | null; resolved: string | null }>
): { overridden: number; discarded: number } {
  const counts = { overridden: 0, discarded: 0 };
  for (const r of rows) {
    if (!r.groundingCounts) continue;
    try {
      const cue: unknown = (JSON.parse(r.groundingCounts) as { notTransactionCue?: unknown }).notTransactionCue;
      if (typeof cue !== 'string') continue;
    } catch {
      continue;
    }
    if (r.resolved === 'overridden') counts.overridden++;
    else if (r.resolved === 'discarded') counts.discarded++;
  }
  return counts;
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
  /** JSON detail; `fmFallbackDetail` rows are counted into `fmFallbacks`. */
  groundingCounts?: string | null;
  /** Which card the row was for — null/absent for a transaction parse (the
   *  default), else a `ParseMetricIntent` ('query', 'tx_op', 'account_*').
   *  `aggregateByEngine` keeps the transaction save/edit rates to null-intent
   *  rows and counts every other intent on its own. */
  intent?: string | null;
}

/** The non-transaction cards a parse_metrics row can be for. A row with no
 *  intent is a transaction parse. Rows recorded before the account_* values
 *  existed carry null, so they still count as transaction rows. */
export type ParseMetricIntent =
  | 'query'
  | 'tx_op'
  | 'account_create'
  | 'account_update'
  | 'account_delete';

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
  /** FM refusals the user overrode with "Log anyway" (the false-refusal signal). */
  refusedOverridden: number;
  /** FM refusals the user accepted (Never mind, or moved on). */
  refusedDismissed: number;
  /** Why the on-device tier fell back, by reason (threw / invalid / unavailable). */
  fmFallbacks: Record<string, number>;
  /** Cue refusals (src/domain/notTransactionCues.ts) by how the user answered. */
  notTransactionCues: { overridden: number; discarded: number };
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
  let refusedOverridden = 0;
  let refusedDismissed = 0;
  const editedByField = { amount: 0, type: 0, payee: 0, category: 0, date: 0 };

  for (const r of rows) {
    inc(byEngine, r.engine);
    inc(byOutcome, r.outcome);
    if (r.outcome === 'clarify_missing' || r.outcome === 'clarify_lowconf') clarify++;
    if (r.resolved === 'saved' || r.resolved === 'edited') saved++;
    // A dismissed refusal is not a discarded draft — count it on its own.
    if (r.outcome === 'refused') {
      if (r.resolved === 'overridden') refusedOverridden++;
      else if (r.resolved === 'discarded') refusedDismissed++;
    } else if (r.resolved === 'discarded') discarded++;
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
    refusedOverridden,
    refusedDismissed,
    fmFallbacks: fmFallbackCounts(rows.map((r) => ({ groundingCounts: r.groundingCounts ?? null }))),
    notTransactionCues: notTransactionCueCounts(
      rows.map((r) => ({ groundingCounts: r.groundingCounts ?? null, resolved: r.resolved }))
    ),
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

// ── aggregateByEngine() — the per-engine view the diagnostics screen shows ──
// Pure, like aggregate(). Closes the loop the parse-quality review found
// open: parse_metrics recorded per-engine outcomes and which fields the user
// edited, but nothing read that back per engine, so there was no way to see
// WHICH engine was earning its corrections.

export interface EngineStats {
  /** Rows for this engine, every outcome and every intent. */
  parses: number;
  /** Transaction parses (no intent) whose outcome was a confirm card — the
   *  only rows the save/edit rates below are computed over. */
  confirms: number;
  /** Of `confirms`, those saved as-is or after an edit (resolved 'saved' |
   *  'edited'). */
  saved: number;
  /** saved / confirms — 0 with no confirms. */
  saveRate: number;
  /** Saved rows the user edited again after saving (the `edited` flag). */
  edited: number;
  /** edited / saved — 0 with no saves. */
  editRate: number;
  /** Per-field share of SAVED rows later edited in that field (0..1 each). */
  editRateByField: { amount: number; type: number; payee: number; category: number; date: number };
  /** Rows the engine refused ("not a transaction"). */
  refused: number;
  /** Refusals the user overrode with "Log anyway" — the false-refusal count. */
  refusedOverridden: number;
  /** Confirm cards where phrase memory put remembered fields on the draft. */
  memoryApplied: number;
  /** Of `memoryApplied`, saved as shown: not corrected on the card
   *  (resolved 'saved', not 'edited') and not edited after saving. */
  memoryKept: number;
  /** memoryKept / memoryApplied — 0 with none applied. */
  memoryKeepRate: number;
  /** Rows for every NON-transaction card (account create/update, delete
   *  handoff, tx_op, query), counted per intent and kept out of the rates
   *  above. Only intents that occurred appear. */
  otherIntents: Record<string, number>;
}

/** Reduce the raw rows to one `EngineStats` per engine name, keyed by
 *  engine. Engines are whatever `engine` values appear in the rows
 *  ('on_device', 'heuristic', 'openai', …) — no fixed list, so a new engine
 *  shows up without a code change here. */
export function aggregateByEngine(rows: AggregateRow[]): Record<string, EngineStats> {
  const acc: Record<
    string,
    {
      parses: number;
      confirms: number;
      saved: number;
      edited: number;
      fields: { amount: number; type: number; payee: number; category: number; date: number };
      refused: number;
      refusedOverridden: number;
      memoryApplied: number;
      memoryKept: number;
      otherIntents: Record<string, number>;
    }
  > = {};
  for (const r of rows) {
    const e = (acc[r.engine] ??= {
      parses: 0,
      confirms: 0,
      saved: 0,
      edited: 0,
      fields: { amount: 0, type: 0, payee: 0, category: 0, date: 0 },
      refused: 0,
      refusedOverridden: 0,
      memoryApplied: 0,
      memoryKept: 0,
      otherIntents: {},
    });
    e.parses++;
    if (r.intent) {
      // Another card kind entirely — an account confirm saved or a tx_op
      // picker resolved says nothing about this engine's transaction parses.
      e.otherIntents[r.intent] = (e.otherIntents[r.intent] ?? 0) + 1;
      continue;
    }
    if (r.outcome === 'refused') {
      e.refused++;
      if (r.resolved === 'overridden') e.refusedOverridden++;
    }
    // Save/edit rates are over confirm cards only: a resolution on any other
    // outcome is not a save of this engine's draft.
    if (r.outcome !== 'confirm') continue;
    e.confirms++;
    const wasSaved = r.resolved === 'saved' || r.resolved === 'edited';
    if (wasSaved) e.saved++;
    if (phraseMemoryOf(r.groundingCounts) === 'applied') {
      e.memoryApplied++;
      if (r.resolved === 'saved' && !r.edited) e.memoryKept++;
    }
    if (wasSaved && r.edited) {
      e.edited++;
      if (r.editedAmount) e.fields.amount++;
      if (r.editedType) e.fields.type++;
      if (r.editedPayee) e.fields.payee++;
      if (r.editedCategory) e.fields.category++;
      if (r.editedDate) e.fields.date++;
    }
  }
  const out: Record<string, EngineStats> = {};
  for (const [engine, e] of Object.entries(acc)) {
    const rate = (n: number) => (e.saved ? n / e.saved : 0);
    out[engine] = {
      parses: e.parses,
      confirms: e.confirms,
      saved: e.saved,
      saveRate: e.confirms ? e.saved / e.confirms : 0,
      edited: e.edited,
      editRate: rate(e.edited),
      editRateByField: {
        amount: rate(e.fields.amount),
        type: rate(e.fields.type),
        payee: rate(e.fields.payee),
        category: rate(e.fields.category),
        date: rate(e.fields.date),
      },
      refused: e.refused,
      refusedOverridden: e.refusedOverridden,
      memoryApplied: e.memoryApplied,
      memoryKept: e.memoryKept,
      memoryKeepRate: e.memoryApplied ? e.memoryKept / e.memoryApplied : 0,
      otherIntents: e.otherIntents,
    };
  }
  return out;
}
