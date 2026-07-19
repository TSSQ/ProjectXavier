/**
 * Recurring series data access. Rule and template are stored as JSON text;
 * they are validated with zod at every trust boundary before writes.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { recurringSeries, transactions } from '../../db/schema';
import { RecurringSeries, RecurrenceTemplate } from '../../domain/types';
import { dueOccurrences, resolveTemplateForPosting } from '../../domain/recurrence';
import { localDayNoon } from '../../domain/dates';
import { recurringSeriesSchema } from '../../lib/validation';
import { newId } from '../../lib/id';

// ─── CRUD ──────────────────────────────────────────────────────────────────

export async function listSeries(): Promise<RecurringSeries[]> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .orderBy(recurringSeries.createdAt);
  return rows.map(rowToSeries);
}

export async function getSeriesById(id: string): Promise<RecurringSeries | null> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.id, id))
    .limit(1);
  return rows[0] ? rowToSeries(rows[0]) : null;
}

export async function createSeries(input: RecurringSeries): Promise<void> {
  const s = recurringSeriesSchema.parse(input);
  await db.insert(recurringSeries).values({
    id: s.id,
    rule: JSON.stringify(s.rule),
    template: JSON.stringify(s.template),
    lastPostedAt: s.lastPostedAt,
    postedCount: s.postedCount,
    paused: s.paused,
    skippedDates: JSON.stringify(s.skippedDates),
    createdAt: s.createdAt,
    archived: s.archived,
  });
}

export async function updateSeries(input: RecurringSeries): Promise<void> {
  const s = recurringSeriesSchema.parse(input);
  await db
    .update(recurringSeries)
    .set({
      rule: JSON.stringify(s.rule),
      template: JSON.stringify(s.template),
      lastPostedAt: s.lastPostedAt,
      postedCount: s.postedCount,
      paused: s.paused,
      skippedDates: JSON.stringify(s.skippedDates),
      archived: s.archived,
    })
    .where(eq(recurringSeries.id, s.id));
}

export async function deleteSeries(id: string): Promise<void> {
  await db.delete(recurringSeries).where(eq(recurringSeries.id, id));
}

// ─── Skip next occurrence ──────────────────────────────────────────────────

/** Adds the series' next upcoming occurrence to its skipped-dates list. */
export async function skipNextOccurrence(series: RecurringSeries, now: number): Promise<void> {
  const { upcomingOccurrences } = await import('../../domain/recurrence');
  const [next] = upcomingOccurrences(series, now, 1);
  if (!next) return;
  const updated: RecurringSeries = {
    ...series,
    skippedDates: [...series.skippedDates, next],
  };
  await updateSeries(updated);
}

// ─── Auto-posting (catch-up on app open) ──────────────────────────────────

/**
 * Posts all due occurrences for every active series as real Transaction rows.
 * Idempotent: uses (series_id, occurrence_date) as a dedup key so re-running
 * is safe even if the app crashed mid-post.
 *
 * Called once after `migrate()` in app/_layout.tsx.
 *
 * Each series is wrapped in its own try/catch: a stored template that can't
 * be posted — most notably a legacy self-transfer template (review F2's bug,
 * reachable via the unvalidated legacy `.json` restore path) — must not
 * throw and silently halt posting for every OTHER series on every launch.
 */
export async function postDueOccurrences(now: number): Promise<void> {
  const allSeries = await listSeries();

  for (const series of allSeries) {
    try {
      const dues = dueOccurrences(series, now);
      if (dues.length === 0) continue;

      // Classify the stored template without throwing (review F2): a
      // self-transfer template — or genuine corruption reachable via the
      // unvalidated legacy `.json` restore path — must not abort posting for
      // every OTHER series. `reason: 'self-transfer'` is skipped because it
      // would only mint economically-neutral rows (`signedDelta` returns 0
      // for them); lastPostedAt/postedCount are deliberately left untouched
      // so it's cheaply re-checked (and re-skipped) on every future post
      // until the user repairs the series.
      const decision = resolveTemplateForPosting(series.template);
      if (!decision.post) continue;
      const tpl: RecurrenceTemplate = decision.template;

      for (const occurrenceDate of dues) {
        // Idempotency check: skip if this (seriesId, occurrenceDate) already exists.
        // Note: this is an exact-epoch match, so it no longer lines up for any
        // legacy row posted under the pre-fix midnight-UTC representation
        // (assessment H3) — the real guard against re-deriving already-posted
        // days for those in-flight series is the normalized `lastPostedAt`
        // cursor in `dueOccurrences`, not this equality check.
        const existing = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.seriesId, series.id),
              eq(transactions.occurrenceDate, occurrenceDate),
            ),
          )
          .limit(1);
        if (existing.length > 0) continue;

        await db.insert(transactions).values({
          id: newId(),
          accountId: tpl.accountId,
          type: tpl.type,
          amount: tpl.amount,
          currency: tpl.currency,
          categoryId: tpl.categoryId ?? null,
          payeeId: tpl.payeeId ?? null,
          transferAccountId: tpl.transferAccountId ?? null,
          note: tpl.note ?? null,
          occurredAt: occurrenceDate,
          createdAt: now,
          source: 'manual' as const,
          receiptRef: null,
          sourceText: null,
          seriesId: series.id,
          occurrenceDate,
          pending: false,
        });
      }

      // Update series tracking after all occurrences for this series are posted.
      const lastPostedAt = dues[dues.length - 1]!;
      const updated: RecurringSeries = {
        ...series,
        lastPostedAt,
        postedCount: series.postedCount + dues.length,
      };
      await updateSeries(updated);
    } catch (e) {
      // Key-free: log the series id (opaque, not PII) and error message only
      // — never the template's amount/account ids/note. One bad series must
      // not stop the others.
      console.error(
        'postDueOccurrences: skipping series (post failed):',
        series.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

// ─── "This and all future" split ───────────────────────────────────────────

/**
 * Splits a series at `occurrenceDate`. The original series is truncated to end
 * just before that date; a new series continues from that date with updated
 * rule/template. Returns the new series id so the caller can update the
 * transaction's seriesId.
 *
 * Also deletes all posted occurrences strictly after occurrenceDate for the
 * original series (they belonged to the future portion now owned by the
 * continuation).
 */
export async function splitAndContinue(
  series: RecurringSeries,
  occurrenceDate: number,
  newTemplate: RecurrenceTemplate,
  now: number,
): Promise<string> {
  const { splitSeriesAt } = await import('../../domain/recurrence');
  const newSeriesId = newId();
  const { truncated, continuation } = splitSeriesAt(
    series,
    occurrenceDate,
    newTemplate,
    { ...series.rule, anchor: localDayNoon(occurrenceDate) },
    newSeriesId,
    now,
  );

  await updateSeries(truncated);
  await createSeries(continuation);

  // Remove future posted occurrences that now belong to the continuation.
  const futureRows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.seriesId, series.id),
      ),
    );
  for (const row of futureRows) {
    // We rely on occurrenceDate being set; only delete rows after the split point.
    const tx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, row.id))
      .limit(1);
    if (tx[0] && tx[0].occurrenceDate !== null && tx[0].occurrenceDate > occurrenceDate) {
      await db.delete(transactions).where(eq(transactions.id, row.id));
    }
  }

  return newSeriesId;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToSeries(row: typeof recurringSeries.$inferSelect): RecurringSeries {
  return {
    id: row.id,
    rule: JSON.parse(row.rule),
    template: JSON.parse(row.template),
    lastPostedAt: row.lastPostedAt ?? null,
    postedCount: row.postedCount,
    paused: Boolean(row.paused),
    skippedDates: JSON.parse(row.skippedDates ?? '[]'),
    createdAt: row.createdAt,
    archived: Boolean(row.archived),
  };
}
