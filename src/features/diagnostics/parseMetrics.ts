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
export {
  aggregate,
  MetricsAggregate,
} from '../../domain/parseMetrics';

export type ParseOutcome =
  | 'blocked'
  | 'clarify_missing'
  | 'clarify_lowconf'
  | 'confirm'
  | 'error'
  // Ask-Xavier queries (docs/design/ask-xavier-queries-spec.md §5.5) — a
  // query-gate hit that a tool answered ('answered'), one no tier could
  // serve ('no_match', the "I can answer things like…" reply), or one that
  // fell through some other way ('fell_through' — e.g. an engine error).
  | 'answered'
  | 'no_match'
  | 'fell_through';

export interface RecordParseInput {
  // 'openai'/'anthropic' (Phase 2 BYOK — docs/design/byok-spec.md) label
  // which cloud provider actually served the parse, matching the schema
  // column's own long-standing 'cloud' | 'heuristic' | 'on_device' comment
  // (src/db/schema.ts) but with the specific provider for better diagnostics.
  // 'floor' (chat-driven account creation — docs/design/account-chat-
  // creation-spec.md §5.5) is distinct from 'heuristic': no extraction engine
  // ran at all (offline/no key/FM incapable), so the confirm card was
  // assembled purely from the deterministic gate's defaults — never confuse
  // this with the expense heuristic tier, which DOES run a real deterministic
  // parse (src/domain/localParse.ts).
  engine: 'heuristic' | 'on_device' | 'openai' | 'anthropic' | 'floor';
  outcome: ParseOutcome;
  // Ask-Xavier queries (spec §5.5) — 'query' distinguishes this row from the
  // default expense/account parse (omitted/null); `tool` is which of the 7
  // query tools answered (omitted when none matched). Both content-free.
  intent?: 'query' | null;
  tool?: string | null;
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
      intent: input.intent ?? null,
      tool: input.tool ?? null,
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

/** Mark how the user resolved the draft (saved / discarded / edited). */
export async function resolveParse(
  parseId: string | null,
  data: { resolved: 'saved' | 'discarded' | 'edited'; txId?: string; payeeSwapped?: boolean }
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

