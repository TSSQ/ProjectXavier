/**
 * Parse-diagnostics data access (test-build-only).
 *
 * Every write is gated by METRICS_ENABLED, so in production each call is a
 * no-op and the table stays empty. Reads (aggregate / export) power the debug
 * screen. See docs/design/parse-metrics-spec.md.
 *
 * Nothing written here is user content: only buckets, booleans, field names,
 * and the random transaction id used to link a post-save edit back to its parse.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { parseMetrics } from '../../db/schema';
import { newId } from '../../lib/id';
import { METRICS_ENABLED } from '../../lib/flags';
import { MaterialEdit } from '../../domain/parseMetrics';

export type ParseOutcome =
  | 'blocked'
  | 'clarify_missing'
  | 'clarify_lowconf'
  | 'confirm'
  | 'error';

export interface RecordParseInput {
  engine: 'cloud' | 'heuristic' | 'on_device';
  outcome: ParseOutcome;
  confidenceBucket?: number | null;
  inputLenBucket?: string | null;
  missingFields?: string[];
  nullFields?: string[];
  groundingCounts?: string | null;
  deviceAiCapable?: boolean | null;
  latencyMs?: number | null;
}

/** Write a parse row. Returns the parse_id to thread through to resolve/edit
 *  (null when metrics are disabled). */
export async function recordParse(
  input: RecordParseInput
): Promise<string | null> {
  if (!METRICS_ENABLED) return null;
  const id = newId();
  try {
    await db.insert(parseMetrics).values({
      id,
      createdAt: Date.now(),
      engine: input.engine,
      outcome: input.outcome,
      confidenceBucket: input.confidenceBucket ?? null,
      inputLenBucket: input.inputLenBucket ?? null,
      missingFields: input.missingFields?.length
        ? input.missingFields.join(',')
        : null,
      nullFields: input.nullFields?.length ? input.nullFields.join(',') : null,
      groundingCounts: input.groundingCounts ?? null,
      deviceAiCapable:
        input.deviceAiCapable == null ? null : input.deviceAiCapable ? 1 : 0,
      latencyMs: input.latencyMs ?? null,
      resolved: null,
      txId: null,
      payeeSwapped: null,
      edited: 0,
      editedAmount: null,
      editedType: null,
      editedPayee: null,
      editedCategory: null,
      editedDate: null,
      amountDeltaBucket: null,
    });
  } catch {
    // Diagnostics must never break the parse flow.
  }
  return id;
}

/** Mark how the user resolved the draft (saved / discarded). */
export async function resolveParse(
  parseId: string | null,
  data: { resolved: 'saved' | 'discarded'; txId?: string; payeeSwapped?: boolean }
): Promise<void> {
  if (!METRICS_ENABLED || !parseId) return;
  try {
    await db
      .update(parseMetrics)
      .set({
        resolved: data.resolved,
        txId: data.txId ?? null,
        payeeSwapped: data.payeeSwapped == null ? null : data.payeeSwapped ? 1 : 0,
      })
      .where(eq(parseMetrics.id, parseId));
  } catch {
    // ignore
  }
}

/** Record the first post-save edit of an AI transaction, linked by tx id. */
export async function recordEditByTxId(
  txId: string,
  edit: MaterialEdit
): Promise<void> {
  if (!METRICS_ENABLED) return;
  try {
    const rows = await db
      .select()
      .from(parseMetrics)
      .where(eq(parseMetrics.txId, txId));
    const row = rows[0];
    if (!row || row.edited) return; // no linked parse, or already recorded
    await db
      .update(parseMetrics)
      .set({
        edited: 1,
        editedAmount: edit.editedAmount ? 1 : 0,
        editedType: edit.editedType ? 1 : 0,
        editedPayee: edit.editedPayee ? 1 : 0,
        editedCategory: edit.editedCategory ? 1 : 0,
        editedDate: edit.editedDate ? 1 : 0,
        amountDeltaBucket: edit.amountDeltaBucket,
      })
      .where(eq(parseMetrics.id, row.id));
  } catch {
    // ignore
  }
}

export type MetricRow = typeof parseMetrics.$inferSelect;

/** All rows, newest first (debug screen / export). */
export async function listMetrics(): Promise<MetricRow[]> {
  if (!METRICS_ENABLED) return [];
  try {
    return await db.select().from(parseMetrics).orderBy(desc(parseMetrics.createdAt));
  } catch {
    return [];
  }
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
  medianLatencyMs: number | null;
  confidenceHistogram: number[]; // index 0..4
}

/** Reduce the raw rows to the headline numbers the debug screen shows. */
export function aggregate(rows: MetricRow[]): MetricsAggregate {
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
  const editedByField = { amount: 0, type: 0, payee: 0, category: 0, date: 0 };

  for (const r of rows) {
    inc(byEngine, r.engine);
    inc(byOutcome, r.outcome);
    if (r.outcome === 'clarify_missing' || r.outcome === 'clarify_lowconf') clarify++;
    if (r.resolved === 'saved') saved++;
    if (r.resolved === 'discarded') discarded++;
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
    medianLatencyMs,
    confidenceHistogram,
  };
}
