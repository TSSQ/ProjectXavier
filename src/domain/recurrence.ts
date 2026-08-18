/**
 * Pure recurrence logic — no framework imports, fully unit-testable in Node.
 *
 * Design decisions baked in:
 *  - All dates are local-noon epoch ms (12:00:00.000 local time of the local
 *    calendar day) — see `localDayNoon` in `dates.ts`. Noon is ~12h from
 *    either midnight, so no timezone offset (±14h) or DST shift (±1h) can
 *    push it across a day boundary. Times within a day are otherwise
 *    discarded; only the calendar date matters for scheduling (assessment H3
 *    fix — the engine used to key on midnight-UTC, which doesn't match the
 *    local-day bucketing the rest of the app uses).
 *  - "Monthly on the 31st" is clamped to the last day of shorter months.
 *  - byDay for monthly/yearly is the target day-of-month (1-31).
 *  - byDay for weekly is the day-of-week (0 = Sun … 6 = Sat), unused — weekly
 *    recurrence just steps by interval × 7 days from the anchor.
 */
import { Account, RecurrenceRule, RecurringSeries, RecurrenceTemplate } from './types';
import { localDayNoon, addLocalDays } from './dates';
import { recurrenceTemplateReadSchema } from '../lib/validation';

export const MS_PER_DAY = 86_400_000;

/** Epoch ms for the given local calendar date at noon, clamping day to the last day of the month. */
function localDateNoonMs(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), 12, 0, 0, 0).getTime();
}

/**
 * Returns the next occurrence date (local-noon epoch ms) strictly after
 * `after`, respecting the recurrence rule. Returns null if the sequence is
 * logically exhausted (only possible for non-infinite rules; callers should
 * also check the `end` condition for count/until limits).
 */
export function nextOccurrenceAfter(rule: RecurrenceRule, after: number): number | null {
  const anchorDay = localDayNoon(rule.anchor);
  const afterDay = localDayNoon(after);

  switch (rule.freq) {
    // Daily/weekly step by whole local calendar days, not fixed ms. Fixed-ms
    // stepping (anchorDay + n * step) stalls across a spring-forward day: a
    // noon-to-noon span that crosses the transition is only 23h, so floor()
    // can compute the same `n` for two different `after` values and the
    // caller's while loop never advances (assessment H3 follow-up — this
    // hung app launch for daily/weekly series once "now" crossed DST).
    // Calendar-day addition is DST-immune and strictly monotonic in `n`.
    case 'daily': {
      const stepDays = rule.interval;
      if (afterDay < anchorDay) return anchorDay;
      // Noon-anchored deltas are integer days ± at most 1h (one DST shift),
      // so rounding recovers the exact day count.
      const daysBetween = Math.round((afterDay - anchorDay) / MS_PER_DAY);
      const n = Math.floor(daysBetween / stepDays) + 1;
      return addLocalDays(anchorDay, n * stepDays);
    }

    case 'weekly': {
      const stepDays = rule.interval * 7;
      if (afterDay < anchorDay) return anchorDay;
      const daysBetween = Math.round((afterDay - anchorDay) / MS_PER_DAY);
      const n = Math.floor(daysBetween / stepDays) + 1;
      return addLocalDays(anchorDay, n * stepDays);
    }

    case 'monthly': {
      const ad = new Date(anchorDay);
      const targetDay = rule.byDay ?? ad.getDate();
      let year = ad.getFullYear();
      let month = ad.getMonth();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = localDateNoonMs(year, month, targetDay);
        if (candidate > afterDay) return candidate;
        month += rule.interval;
        year += Math.floor(month / 12);
        month = ((month % 12) + 12) % 12;
      }
    }

    case 'yearly': {
      const ad = new Date(anchorDay);
      const targetMonth = ad.getMonth();
      const targetDay = rule.byDay ?? ad.getDate();
      let year = ad.getFullYear();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = localDateNoonMs(year, targetMonth, targetDay);
        if (candidate > afterDay) return candidate;
        year += rule.interval;
      }
    }
  }
}

/**
 * Returns all occurrence dates that are due between (lastPostedAt, now] and
 * satisfy the rule's end condition. Skipped dates are omitted. Each element is
 * a local-noon epoch ms.
 *
 * Safe to call repeatedly — already-posted dates are excluded because the
 * cursor starts at lastPostedAt.
 */
export function dueOccurrences(series: RecurringSeries, now: number): number[] {
  if (series.paused || series.archived) return [];

  const { rule, lastPostedAt, postedCount, skippedDates } = series;
  const skipped = new Set(skippedDates);
  const nowDay = localDayNoon(now);
  const anchorDay = localDayNoon(rule.anchor);
  const results: number[] = [];
  let count = postedCount;
  // Start searching strictly after the last posted date. If nothing posted
  // yet, start a full day before the anchor so the anchor itself is
  // included — anchorDay is local *noon*, so (unlike a midnight identity) a
  // 1ms nudge stays on the same calendar day; stepping back a whole day is
  // what's needed to land on the previous local day. Normalize a stored
  // lastPostedAt through localDayNoon too — in-flight series may still carry
  // a pre-fix midnight-UTC value; without normalizing here, the
  // representation switch could double-post or skip the next occurrence.
  let cursor = lastPostedAt !== null ? localDayNoon(lastPostedAt) : anchorDay - MS_PER_DAY;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (rule.end.kind === 'count' && count >= rule.end.n) break;
    const next = nextOccurrenceAfter(rule, cursor);
    if (next === null || next > nowDay) break;
    if (rule.end.kind === 'until' && next > localDayNoon(rule.end.date)) break;
    cursor = next;
    if (!skipped.has(next)) {
      results.push(next);
      count++;
    }
  }
  return results;
}

// ─── Pause via account archive (docs/design/account-archive-restore-spec.md
// §8.3) ──────────────────────────────────────────────────────────────────
//
// Archiving an account pauses its recurring series WITHOUT writing any
// paused/archived flag on the series itself — the behaviour is derived from
// account state (the same doctrine future-dated transactions use for
// `occurredAt`), so unarchive never has to guess whether a stopped series
// was paused by us or by the user. Two pieces:
//  - `postableOccurrences` — the post-time gate. A series whose target
//    account is archived yields nothing, so nothing is created and nothing
//    is written — the series' own `lastPostedAt` cursor stays exactly where
//    it was.
//  - `seriesToResumeOnUnarchive` — because the cursor was left stranded
//    above, resuming naively (just letting `dueOccurrences` run again) would
//    back-post the ENTIRE archived gap in one go. This computes the cursor
//    move that must happen once, at unarchive, so the schedule resumes
//    forward from that moment instead.

/**
 * Whether `series`'s template references `accountId` — either as the
 * primary account (`accountId`) or, for a transfer, the destination
 * (`transferAccountId`). Both sides count: posting a transfer changes both
 * accounts' balances off the very same row (`signedDelta` in balances.ts),
 * so an archived account on EITHER side is a series "targeting" it — the
 * same doctrine `computeAccountDeleteImpact` and `deleteAccountCascade`
 * already use for what counts as a series "referencing" an account.
 */
export function seriesTargetsAccount(series: RecurringSeries, accountId: string): boolean {
  return (
    series.template.accountId === accountId || series.template.transferAccountId === accountId
  );
}

/**
 * True when `series` targets an account that is currently archived (spec
 * §8.3). `accounts` is the full list — this filters internally, the same
 * "hand it everything, the function decides what matters" shape
 * `netWorth`/`accountPeriodBalances` use in balances.ts.
 */
export function hasArchivedTarget(series: RecurringSeries, accounts: Account[]): boolean {
  return accounts.some((a) => a.archived === true && seriesTargetsAccount(series, a.id));
}

/**
 * `dueOccurrences`, additionally gated on the series' target account not
 * being archived (spec §8.3's post-time gate). `dueOccurrences` itself is
 * deliberately left untouched — it only ever looks at the series' own
 * `paused`/`archived` flags, so every existing caller (and the whole
 * `recurring.feature` regression suite) keeps behaving exactly as before.
 * This is the higher-level "is this actually postable right now" check
 * `postDueOccurrences` (src/features/recurring/repository.ts) calls
 * instead: when the target account is archived, it short-circuits to `[]`
 * without even asking `dueOccurrences` — creating nothing, and critically,
 * never advancing anything, so the cursor stays exactly where the last real
 * post left it until `seriesToResumeOnUnarchive` moves it forward at
 * unarchive.
 */
export function postableOccurrences(
  series: RecurringSeries,
  now: number,
  accounts: Account[],
): number[] {
  if (hasArchivedTarget(series, accounts)) return [];
  return dueOccurrences(series, now);
}

/**
 * Which series need their `lastPostedAt` cursor advanced when `accountId` is
 * unarchived, and what to advance it to — `now`, normalized to local noon
 * (`dueOccurrences`'s cursor is calendar-day granularity; see its own header
 * comment). Selects exactly the series targeting `accountId`
 * (`seriesTargetsAccount`) and returns them with `lastPostedAt` moved
 * forward; every other series is simply absent from the result, untouched.
 *
 * This is the fix for the gap the post-time gate can't see on its own:
 * `dueOccurrences`'s cursor only ever advances by posting, so a series
 * silently skipped by `postableOccurrences` for months would otherwise
 * back-post the ENTIRE gap in one run the moment the account returns —
 * exactly the opposite of what archiving was asked to do. Jumping the
 * cursor to "now" at the moment of restore instead means the next
 * occurrence is computed forward from the restore — "paused, not deferred"
 * (spec §8.3): nothing accrues in between and nothing is delivered late.
 *
 * Deliberately touches ONLY `lastPostedAt` — never `paused`, `archived`,
 * `postedCount`, or anything else. In particular this must never look like
 * a post (no transaction is created here, so `postedCount` does not move),
 * and it must never flip a series the USER paused back to running — that
 * flag is left exactly as it was, whatever it was (a series a user paused
 * themselves stays paused across an archive/unarchive cycle).
 */
export function seriesToResumeOnUnarchive(
  allSeries: RecurringSeries[],
  accountId: string,
  now: number,
): RecurringSeries[] {
  const resumeAt = localDayNoon(now);
  return allSeries
    .filter((s) => seriesTargetsAccount(s, accountId))
    .map((s) => ({ ...s, lastPostedAt: resumeAt }));
}

export type TemplatePostDecision =
  | { post: true; template: RecurrenceTemplate }
  | { post: false; reason: 'invalid' | 'self-transfer' };

/**
 * Decides whether a stored recurrence template can be posted as a new
 * transaction occurrence (review F2 — Major 1). Uses the read/restore-
 * tolerant `recurrenceTemplateReadSchema`, not the write-strict
 * `recurrenceTemplateSchema`: a stored self-transfer template — reachable
 * via the unvalidated legacy `.json` restore path — must never THROW here;
 * it's classified explicitly instead so one bad series can't halt posting
 * for every other series:
 *  - `reason: 'invalid'` — genuine corruption (bad amount/type/etc.); the
 *    caller should skip this series without posting.
 *  - `reason: 'self-transfer'` — same account on both sides; would only mint
 *    an economically-neutral row (`signedDelta` returns 0 for it), so it's
 *    skipped rather than posted every cycle.
 * Pure and Node-testable — extracted out of `postDueOccurrences`
 * (src/features/recurring/repository.ts, the only caller), which touches the
 * live DB and so is exercised outside the Node BDD suite.
 */
export function resolveTemplateForPosting(raw: unknown): TemplatePostDecision {
  const parsed = recurrenceTemplateReadSchema.safeParse(raw);
  if (!parsed.success) return { post: false, reason: 'invalid' };
  const template = parsed.data as RecurrenceTemplate;
  if (template.transferAccountId && template.transferAccountId === template.accountId) {
    return { post: false, reason: 'self-transfer' };
  }
  return { post: true, template };
}

/**
 * Returns the next `limit` occurrence dates that come strictly after `from`
 * (epoch ms), useful for the Planned list and forecast. Never returns posted
 * occurrences — call this with `from = now` to see what's upcoming.
 */
export function upcomingOccurrences(
  series: RecurringSeries,
  from: number,
  limit: number,
): number[] {
  if (series.archived) return [];

  const { rule, postedCount, skippedDates } = series;
  const skipped = new Set(skippedDates);
  const results: number[] = [];
  let count = postedCount;
  let cursor = from;

  while (results.length < limit) {
    if (rule.end.kind === 'count' && count >= rule.end.n) break;
    const next = nextOccurrenceAfter(rule, cursor);
    if (next === null) break;
    if (rule.end.kind === 'until' && next > localDayNoon(rule.end.date)) break;
    cursor = next;
    if (!skipped.has(next)) {
      results.push(next);
      count++;
    }
  }
  return results;
}

/**
 * Returns the projected net worth at `until` by adding/subtracting all
 * upcoming scheduled occurrences between `from` and `until` (exclusive) to the
 * actual net worth. Transfers are net-worth-neutral and are excluded.
 */
export function forecastNetWorth(
  actualNetWorth: number,
  allSeries: RecurringSeries[],
  from: number,
  until: number,
  currency: string,
): number {
  let forecast = actualNetWorth;
  for (const series of allSeries) {
    if (series.archived || series.paused) continue;
    if (series.template.currency !== currency) continue;
    const upcoming = upcomingOccurrences(series, from, 10_000);
    for (const date of upcoming) {
      if (date >= until) break;
      const { amount, type } = series.template;
      if (type === 'income') forecast += amount;
      else if (type === 'expense') forecast -= amount;
    }
  }
  return forecast;
}

/**
 * Human-readable label for a recurrence rule, matching the preset names shown
 * in the UI.
 */
export function describeRule(rule: RecurrenceRule): string {
  const { freq, interval } = rule;
  if (freq === 'daily') return interval === 1 ? 'Daily' : `Every ${interval} days`;
  if (freq === 'weekly') {
    if (interval === 1) return 'Weekly';
    if (interval === 2) return 'Every 2 weeks';
    if (interval === 3) return 'Every 3 weeks';
    if (interval === 4) return 'Every 4 weeks';
    return `Every ${interval} weeks`;
  }
  if (freq === 'monthly') {
    if (interval === 1) return 'Monthly';
    if (interval === 2) return 'Every 2 months';
    if (interval === 3) return 'Quarterly';
    if (interval === 6) return 'Semi-annually';
    return `Every ${interval} months`;
  }
  if (freq === 'yearly') return interval === 1 ? 'Annual' : `Every ${interval} years`;
  return 'Custom';
}

/** Short label for the Repeat row in the transaction sheet. */
export function describeRuleShort(rule: RecurrenceRule | null): string {
  if (!rule) return 'Never';
  return describeRule(rule);
}

/**
 * Splits a series at `occurrenceDate` for "this and all future" edits.
 * Returns:
 *  - `truncated`: original series with end set to just before occurrenceDate
 *  - `continuation`: new series starting at occurrenceDate with newRule/newTemplate
 *
 * The caller is responsible for:
 *  - persisting both series in the DB
 *  - updating the edited transaction's seriesId to `continuation.id`
 *  - deleting any already-posted occurrences after occurrenceDate from the DB
 */
export function splitSeriesAt(
  series: RecurringSeries,
  occurrenceDate: number,
  newTemplate: RecurrenceTemplate,
  newRule: RecurrenceRule,
  newSeriesId: string,
  now: number,
): { truncated: RecurringSeries; continuation: RecurringSeries } {
  // The cutoff must land on the day BEFORE occurrenceDate. A 1ms nudge no
  // longer crosses a day boundary under noon identity (noon - 1ms
  // renormalizes back to the same day), so the truncated series would still
  // report occurrenceDate as due and both series would post it — step back a
  // full calendar day instead.
  const cutoff = addLocalDays(localDayNoon(occurrenceDate), -1);
  const truncated: RecurringSeries = {
    ...series,
    rule: { ...series.rule, end: { kind: 'until', date: cutoff } },
  };
  const continuation: RecurringSeries = {
    ...series,
    id: newSeriesId,
    rule: { ...newRule, anchor: localDayNoon(occurrenceDate) },
    template: newTemplate,
    lastPostedAt: null,
    postedCount: 0,
    skippedDates: [],
    createdAt: now,
  };
  return { truncated, continuation };
}

/**
 * Assemble a brand-new `RecurringSeries` from a just-entered transaction.
 *
 * Extracted because three screens can now start a series — the transactions
 * FAB, the assistant's confirm-card editor, and an account's Add sheet — and
 * only the first of them used to. The series' non-obvious parts are the ones
 * worth having in exactly one place: the rule is anchored to the
 * transaction's own day at LOCAL NOON (not the raw timestamp, or DST would
 * drift every occurrence), and a fresh series starts un-posted, un-paused,
 * un-skipped and un-archived. A screen that forgets any of those produces a
 * series that silently never posts.
 *
 * Pure — the caller supplies `id` and `createdAt` rather than this reaching
 * for `newId()`/`Date.now()`, so the result is fully determined by its input.
 */
export function buildRecurringSeries(args: {
  id: string;
  rule: RecurrenceRule;
  template: RecurrenceTemplate;
  /** The transaction's own date; becomes the series anchor at local noon. */
  occurredAt: number;
  createdAt: number;
}): RecurringSeries {
  return {
    id: args.id,
    rule: { ...args.rule, anchor: localDayNoon(args.occurredAt) },
    template: args.template,
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: args.createdAt,
    archived: false,
  };
}
