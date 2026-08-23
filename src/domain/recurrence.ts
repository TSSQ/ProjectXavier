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
import { Account, RecurrenceRule, RecurringSeries, RecurrenceTemplate, Transaction } from './types';
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
  // A rule that cannot move forward must never reach the walks below: with
  // interval 0 the monthly/yearly `while (true)` recomputes the same candidate
  // for ever and the JS thread never comes back — not slow, genuinely
  // infinite. Measured; daily/weekly instead returned NaN, which is quieter
  // but no more correct. `recurrenceRuleSchema` rejects interval < 1 on every
  // WRITE, but `rowToSeries` does not validate on read, so a legacy or
  // restored row (the unvalidated `.json` path) can still carry one — and
  // this function runs on app launch via postDueOccurrences and on every
  // render of the Planned/Upcoming lists.
  //
  // Returning null is the existing "sequence exhausted" signal that every
  // caller already handles, so a broken series simply schedules nothing
  // instead of taking the app down with it.
  if (!Number.isFinite(rule.interval) || rule.interval < 1) return null;

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

    // ⚠️ monthly/yearly walk forward FROM THE ANCHOR on every call, because
    // day-of-month clamping (Jan 31 → Feb 28) makes the step count awkward to
    // compute arithmetically the way daily/weekly do above. That makes any
    // caller generating N consecutive occurrences O(N²): measured at 9.6s
    // (monthly) and 9.2s (yearly) for N=10,000, versus ~3ms for daily/weekly.
    // Callers must therefore bound by DATE — see upcomingOccurrences' `until`,
    // whose absence is what froze the app on device. Raising a limit without a
    // date bound reintroduces this.
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
  /**
   * Exclusive date bound — stop as soon as an occurrence lands on or after it.
   *
   * Load-bearing for any caller that wants "everything in a window". A series
   * with `end: never` has no natural stopping point, so before this the only
   * brake was `limit`, and the dashboard's 30-day forecast passed 10_000: it
   * generated occurrences into the year 2859 to answer a question about the
   * next month. That is also QUADRATIC, because monthly/yearly
   * `nextOccurrenceAfter` re-walks from the anchor on every call — measured at
   * 9.7s per series on a Mac, synchronous on the JS thread, which on device
   * showed up as an app that rendered nothing and accepted no touches.
   *
   * With a bound the work is proportional to the occurrences actually in the
   * window, and `limit` goes back to being a backstop.
   */
  until?: number,
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
    if (until != null && next >= until) break;
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
    // Bounded by `until`, not by the limit: the limit is only a backstop now
    // (a daily series over a 30-day horizon needs 30, not 10_000). See
    // upcomingOccurrences' `until` for what the unbounded version cost.
    const upcoming = upcomingOccurrences(series, from, 10_000, until);
    // Every returned date is already inside [from, until), so the dates
    // themselves no longer matter — only how many there are.
    const { amount, type } = series.template;
    if (type === 'income') forecast += amount * upcoming.length;
    else if (type === 'expense') forecast -= amount * upcoming.length;
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
 * drift every occurrence), and the cursor starts at the creation day rather
 * than at the beginning of the schedule (see below — starting un-posted is
 * what back-posted a year of charges). A screen that forgets either produces
 * a series that silently never posts, or one that posts far too much.
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
  const anchor = localDayNoon(args.occurredAt);
  // The anchor keeps the SHAPE of the schedule (a "4th of the month" series
  // entered as the 4th keeps landing on the 4th), but the cursor starts no
  // earlier than the day the series was created — otherwise every occurrence
  // between an old start date and today is genuinely "due" and posts at once.
  const cursor = Math.max(anchor, localDayNoon(args.createdAt));
  return {
    id: args.id,
    rule: { ...args.rule, anchor },
    template: args.template,
    // The anchor occurrence is the transaction the user just entered, so the
    // series starts having ALREADY accounted for it.
    //
    // Starting un-posted meant `dueOccurrences` began its search a day BEFORE
    // the anchor, so a series dated in the past immediately back-posted every
    // occurrence between then and today. Measured: a monthly subscription
    // entered with a start date one year ago posted 13 charges at once — the
    // user typed one amount and their balance moved by thirteen times it,
    // silently. Daily was worse (54 rows for a 7-week-old start date).
    //
    // Callers therefore create the entered transaction themselves rather than
    // letting the poster mint it; that also means a FUTURE-dated recurring
    // entry now exists as a real (future-dated) row straight away instead of
    // vanishing until its date arrives.
    lastPostedAt: cursor,
    postedCount: 1,
    paused: false,
    skippedDates: [],
    createdAt: args.createdAt,
    archived: false,
  };
}

/**
 * The name to show for a recurring series.
 *
 * A series' occurrence rows in the ledger are titled by payee
 * (`payeeName ?? sentenceCase(type)` — see TransactionRow/FeedRecord), but the
 * two surfaces that render the SERIES rather than its rows — the Transactions
 * "Upcoming" strip and the Recurring screen — titled by `template.type`
 * instead. The same Netflix subscription therefore read "Netflix" in the
 * ledger and "Expense" in both of the places whose whole job is telling you
 * what is coming.
 *
 * Precedence is payee, then category, then the type. Category is included
 * (unlike TransactionRow, which shows it on the detail line) because a series
 * with no payee is exactly the case where the type alone says nothing: for an
 * upcoming charge, "Subscription" is information and "Expense" is not.
 *
 * Takes resolved names rather than ids so it stays pure and framework-free —
 * the caller already holds the lookup maps.
 */
export function seriesTitle(
  template: RecurrenceTemplate,
  names: { payeeName?: string | null; categoryName?: string | null } = {}
): string {
  const payee = names.payeeName?.trim();
  if (payee) return payee;
  const category = names.categoryName?.trim();
  if (category) return category;
  return template.type.charAt(0).toUpperCase() + template.type.slice(1);
}

// ─── back-posted occurrence detection ───────────────────────────────────────

/** How long after a series is created a row may still have been written by
 *  the same posting batch. Back-posting happened inside the
 *  `createSeries` → `postDueOccurrences` sequence, so those rows land within
 *  seconds; five minutes is generous even for a 50-row catch-up. */
const SAME_BATCH_MS = 5 * 60 * 1000;

/** The template fields a posted occurrence copies verbatim. A row that still
 *  matches all of them was written by the machine and never touched. */
function matchesTemplate(tx: Transaction, t: RecurrenceTemplate): boolean {
  return (
    tx.type === t.type &&
    tx.amount === t.amount &&
    tx.currency === t.currency &&
    (tx.categoryId ?? null) === (t.categoryId ?? null) &&
    (tx.payeeId ?? null) === (t.payeeId ?? null) &&
    (tx.transferAccountId ?? null) === (t.transferAccountId ?? null) &&
    (tx.note ?? null) === (t.note ?? null) &&
    tx.accountId === t.accountId
  );
}

/**
 * Ids of transactions this series posted that it should never have posted:
 * occurrences dated BEFORE the series existed.
 *
 * This is the clean-up half of the back-posting bug (see
 * `buildRecurringSeries`). Fixing the cause does not undo rows already
 * written, so they have to be identified — and since acting on this deletes
 * financial data, the predicate is deliberately narrow. A row qualifies only
 * when ALL of the following hold:
 *
 *  1. it belongs to this series and is a POSTED occurrence (`occurrenceDate`
 *     is set — a manual row merely tagged to a series has none);
 *  2. it is NOT the anchor occurrence, which is the transaction the user
 *     actually typed and must survive;
 *  3. it is dated before the day the series was created — an occurrence
 *     predating its own series cannot have been legitimately scheduled;
 *  4. it was written in the same moment the series was created, which is what
 *     back-posting did. A genuinely late-posted occurrence is written on its
 *     own due date, long after. This is what protects a user whose device
 *     clock was wrong when the series was created: their real occurrences
 *     were posted later, so they are left alone;
 *  5. it still matches the template exactly. If the user edited the amount,
 *     payee or note, that is human input and is never deleted, however
 *     invented the row was to begin with.
 *
 * Returns ids only; the caller decides what to do with them.
 */
export function backPostedOccurrences(
  series: RecurringSeries,
  transactions: Transaction[]
): string[] {
  const anchorDay = localDayNoon(series.rule.anchor);
  const createdDay = localDayNoon(series.createdAt);
  return transactions
    .filter((tx) => {
      if (tx.seriesId !== series.id) return false;
      if (tx.occurrenceDate == null) return false;
      const occDay = localDayNoon(tx.occurrenceDate);
      if (occDay === anchorDay) return false;
      if (occDay >= createdDay) return false;
      const writtenWithBatch =
        tx.createdAt >= series.createdAt &&
        tx.createdAt - series.createdAt <= SAME_BATCH_MS;
      if (!writtenWithBatch) return false;
      return matchesTemplate(tx, series.template);
    })
    .map((tx) => tx.id);
}
