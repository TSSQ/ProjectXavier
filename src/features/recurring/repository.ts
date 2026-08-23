/**
 * Recurring series data access. Rule and template are stored as JSON text;
 * they are validated with zod at every trust boundary before writes.
 */
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../../db/client';
import { recurringSeries, transactions } from '../../db/schema';
import { RecurringSeries, RecurrenceTemplate, RecurrenceRule } from '../../domain/types';
import {
  postableOccurrences,
  resolveTemplateForPosting,
  seriesToResumeOnUnarchive,
} from '../../domain/recurrence';
import { localDayNoon } from '../../domain/dates';
import { recurringSeriesSchema } from '../../lib/validation';
import { newId } from '../../lib/id';
import { bumpDataRevision } from '../settings/repository';
// Account state decides whether a series is postable (docs/design/
// account-archive-restore-spec.md §8.3), so `postDueOccurrences` needs the
// account list too. This creates a deliberate two-file import cycle with
// accounts/repository.ts (which imports `listSeries` from THIS file, for
// `deleteAccountCascade`'s impact snapshot) — safe here because both sides
// only ever call each other's exports from inside async function bodies,
// never at module-eval time (same precedent as backup/repository.ts <->
// accounts/repository.ts, documented on `createBackupUnlocked`).
import { listAccounts } from '../accounts/repository';

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
  await bumpDataRevision();
}

/** Raw row update, no revision bump — used internally by `updateSeries`
 *  (which bumps once after) and by `postDueOccurrences`' per-series
 *  tracking update (which bumps once for the whole batch instead — see
 *  that function's header). Not exported: callers outside this file always
 *  want the bump, so they should go through `updateSeries`. */
async function updateSeriesRow(s: RecurringSeries): Promise<void> {
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

// pause/skip/archive have no separate exports — callers set the relevant
// field(s) and call this same updateSeries (see app/recurring.tsx and
// skipNextOccurrence below), so bumping here also covers those chokepoints.
export async function updateSeries(input: RecurringSeries): Promise<void> {
  const s = recurringSeriesSchema.parse(input);
  await updateSeriesRow(s);
  await bumpDataRevision();
}

export async function deleteSeries(id: string): Promise<void> {
  await db.delete(recurringSeries).where(eq(recurringSeries.id, id));
  await bumpDataRevision();
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
 *
 * Revision bump (review F3 / M4): once for the whole batch, not once per
 * series and not once per occurrence — a 30-day catch-up across several
 * series is one revision step, since the signature only needs to be
 * *different*, not counted. The per-series tracking update below therefore
 * uses the un-bumping `updateSeriesRow` helper, not the public `updateSeries`.
 *
 * Archived-account gate (docs/design/account-archive-restore-spec.md §8.3):
 * uses `postableOccurrences` instead of calling `dueOccurrences` directly —
 * a series whose target account is archived yields nothing here, so it
 * posts nothing AND its `lastPostedAt` cursor is left exactly where it was
 * (no series row is touched at all). `resumeSeriesForAccount` below is what
 * moves that cursor forward, once, at unarchive.
 */
export async function postDueOccurrences(now: number): Promise<void> {
  const allSeries = await listSeries();
  const accounts = await listAccounts();
  let postedAny = false;

  for (const series of allSeries) {
    try {
      const dues = postableOccurrences(series, now, accounts);
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
        postedAny = true;
      }

      // Update series tracking after all occurrences for this series are
      // posted. Uses the un-bumping raw row update (see this function's
      // header) — the whole batch bumps once, below.
      const lastPostedAt = dues[dues.length - 1]!;
      const updated: RecurringSeries = {
        ...series,
        lastPostedAt,
        postedCount: series.postedCount + dues.length,
      };
      await updateSeriesRow(recurringSeriesSchema.parse(updated));
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

  if (postedAny) {
    await bumpDataRevision();
  }
}

// ─── Resume on unarchive (spec §8.3) ───────────────────────────────────────

/**
 * Advances the `lastPostedAt` cursor to `now` for every series targeting
 * `accountId` — called once, from `app/manage-accounts.tsx`'s `onUnarchive`,
 * when the account is unarchived. Pairs with the archived-account gate
 * inside `postDueOccurrences` (via `postableOccurrences`), which skips
 * posting for a series targeting an archived account WITHOUT touching its
 * cursor: without this step, the cursor would stay stranded at its
 * pre-archive value, and the very next `postDueOccurrences` run would
 * back-post every occurrence missed across the whole archived period — the
 * opposite of what archiving was asked to do. See `seriesToResumeOnUnarchive`
 * for the pure selection/cursor logic; this is the thin DB write around it.
 *
 * Each series is updated independently inside its own try/catch — the same
 * defensive posture as `postDueOccurrences` — so one series with a corrupt
 * or legacy self-transfer template (reachable via the unvalidated legacy
 * `.json` restore path) can't stop the cursor from advancing for every OTHER
 * series targeting this account.
 *
 * Deliberately does NOT touch `paused`/`archived` on any series (see
 * `seriesToResumeOnUnarchive`'s header) — a series the user paused
 * themselves stays paused. A no-op (no DB write, no revision bump) when
 * nothing targets this account.
 */
export async function resumeSeriesForAccount(accountId: string, now: number): Promise<void> {
  const allSeries = await listSeries();
  const toResume = seriesToResumeOnUnarchive(allSeries, accountId, now);
  let resumedAny = false;

  for (const s of toResume) {
    try {
      await updateSeriesRow(recurringSeriesSchema.parse(s));
      resumedAny = true;
    } catch (e) {
      // Key-free, same as postDueOccurrences above: series id + error
      // message only. One bad series must not stop the cursor from
      // advancing for the others targeting this account.
      console.error(
        'resumeSeriesForAccount: skipping series (cursor advance failed):',
        s.id,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (resumedAny) {
    await bumpDataRevision();
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
  /** The schedule from the split point on. Defaults to the current one, so a
   *  caller changing only the amount need not restate it — but editing the
   *  SCHEDULE is the main reason this is reachable from the UI at all, and
   *  before this parameter existed it was the one thing a split could not
   *  change. */
  newRule?: RecurrenceRule,
): Promise<string> {
  const { splitSeriesAt } = await import('../../domain/recurrence');
  const newSeriesId = newId();
  const { truncated, continuation } = splitSeriesAt(
    series,
    occurrenceDate,
    newTemplate,
    { ...(newRule ?? series.rule), anchor: localDayNoon(occurrenceDate) },
    newSeriesId,
    now,
  );

  await updateSeries(truncated);
  await createSeries(continuation);

  // Remove already-posted occurrences AFTER the split point — they belong to
  // the continuation's schedule now and would otherwise be duplicated by it.
  // Rows on or before the split point are the user's history and are left
  // exactly as they are, which is the whole contract of this operation.
  //
  // One statement rather than the previous select-all-then-select-each-then-
  // delete loop: that issued 2N+1 queries and re-read every row of the series
  // to test a column it had already been able to select.
  await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.seriesId, series.id),
        gt(transactions.occurrenceDate, occurrenceDate),
      ),
    );

  // The raw delete above is a financial mutation; bump the data revision here so
  // this action's auto-backup signal is guaranteed by construction, not merely
  // incidental to the updateSeries/createSeries bumps earlier in this function
  // (review F3 — a future reorder must not silently reintroduce M4).
  await bumpDataRevision();

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
