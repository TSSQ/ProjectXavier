# Spec: fix assessment H3 — recurring transactions post on the wrong local day

Source: `docs/assessment-2026-07-12.md`, finding **H3**. Bug fix, determined
shape (the local-noon pattern is already the house convention — see
`deviceParsePrompt.ts` and `dates.ts`/`period.ts`). No product fork → spec
auto-passes; recorded here for the QA/review gates.

## Objective

Recurring transactions must land on the calendar day the user intends, in
**every** timezone — anchored on the local day they were created, posted on
the local day they're due. Today they don't: the engine's day identity is
midnight-UTC while the whole rest of the app buckets by **local** day.

## The bug (root cause)

`src/domain/recurrence.ts` represents every occurrence/anchor as
`startOfUTCDay(epoch)` = midnight UTC ([recurrence.ts:16](src/domain/recurrence.ts#L16)),
and all its date math uses `Date.UTC(...)` / `getUTC*()`. But:

- Transactions are bucketed for display/aggregation by **local** day —
  `dates.ts` (`getDate()`, `startOfDay`, `sameDay`) and `period.ts`
  (`new Date(y, m, d)` local constructor). So a midnight-UTC `occurredAt`
  renders on the **previous local day** in any UTC-negative zone, and can fall
  in the previous month/widget total on the 1st.
- The anchor is floored from a **local** timestamp:
  [transactions.tsx:251](app/(tabs)/transactions.tsx#L251) does
  `startOfUTCDay(occurredAt)`, so in UTC+8 a series created before 08:00 local
  anchors one calendar day early.

All 17 scenarios in `tests/__features__/recurring.feature` are pure-UTC, so the
suite (which runs at the machine's TZ, usually UTC in CI) never sees it.

## Approach — local-noon day identity (mirror the parse pipeline)

Local **noon** (not midnight) is the safe canonical instant for a calendar
day: it's ~12h from either midnight, so no timezone offset (±14h) and no DST
shift (±1h) can push it across a day boundary. The parse pipeline already does
exactly this at [deviceParsePrompt.ts:510](src/domain/deviceParsePrompt.ts#L510)
(`new Date(y, m-1, d, 12, 0, 0, 0)`).

### 1. New helper (single source of truth)

Add to `src/domain/dates.ts` (framework-free, already the date-util home):

```ts
/** Epoch ms at 12:00 local time of the local calendar day containing `epoch`.
 *  The timezone-stable identity for a calendar day used by the recurrence
 *  engine — noon avoids the midnight/DST off-by-one that midnight-UTC caused
 *  (assessment H3). */
export function localDayNoon(epoch: number): number {
  const d = new Date(epoch);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}
```

### 2. Recurrence engine (`src/domain/recurrence.ts`)

Replace the UTC day model with the local-noon model throughout:

- Delete `startOfUTCDay`; use `localDayNoon` for every place it appears
  (anchorDay, afterDay, nowDay, `rule.end.date` comparisons, `splitSeriesAt`
  cutoff + continuation anchor — lines 33-34, 96-97, 109, 141, 228, 236).
- Weekly/daily stepping (`anchorDay + n*step`): after computing each `next`,
  **re-normalize through `localDayNoon(next)`** so fixed-ms stepping across a
  DST boundary (a 23h/25h day) can't accumulate drift off noon. `step` stays
  `interval * DAY_MS` (or `*7`).
- Monthly/yearly branches: replace `Date.UTC(year, month, day)` with
  `new Date(year, month, Math.min(day, lastDay), 12, 0, 0, 0).getTime()` and
  `getUTCFullYear/Month/Date` → local `getFullYear/Month/Date`. Month-length
  clamp (`Math.min(day, lastDay)`) stays.
- `dueOccurrences`: normalize the `lastPostedAt` cursor through `localDayNoon`
  as well (in-flight soak series stored a midnight-UTC `lastPostedAt`; without
  normalizing, the representation switch could double-post or skip one).

### 3. External callers → the new helper

- `app/(tabs)/transactions.tsx:251` — anchor `localDayNoon(occurredAt)`.
- `src/features/recurring/repository.ts:168` — split continuation anchor.
- `src/components/ui/RepeatSheet.tsx:30,120,127` — anchor + `until` date.
- `src/features/recurring/repository.ts` post site (~122): no change needed at
  the insert — `occurrenceDate` now arrives from the engine as local-noon, so
  `occurredAt: occurrenceDate` buckets on the correct local day. Verify both
  `occurredAt` and `occurrenceDate` carry the noon value.

## Acceptance criteria (testable, plain-Node BDD)

1. Re-pin the existing 17 `recurring.feature` scenarios to the local-noon
   representation (they assert exact epochs that change). Behaviour (which days
   fire, dedup, end/until, split) must be unchanged — only the stored instant
   moves from midnight-UTC to local-noon.
2. **TZ-pinned proof (the point of the fix).** Add coverage that asserts the
   **local calendar day** of posted/dued occurrences is correct, and run it
   under at least two pinned zones — `TZ=Asia/Singapore` (UTC+8, the dev's
   zone) and `TZ=America/New_York` (UTC-5, the assessment's example). The
   plain-Node suite honors `process.env.TZ`. Concretely:
   - A daily series anchored on "local today" posts occurrences whose
     `new Date(occ).getDate()` equals the intended local day in BOTH zones
     (before the fix, UTC-5 lands a day early).
   - A monthly series on the 1st: the posted occurrence's local month is the
     intended month in both zones (guards the previous-month regression).
   - Wire a TZ test leg into `package.json`, e.g.
     `"test:tz": "TZ=America/New_York jest recurring && TZ=Asia/Singapore jest recurring"`,
     and keep default `npm test` green too. (If jest/V8 doesn't honor a runtime
     `process.env.TZ` change reliably, set it via the npm-script env as above —
     process-level TZ is honored; don't mutate it mid-run.)
3. `npm run typecheck && npm run lint && npm test` green in the worktree; and
   the new `test:tz` leg green.

## Constraints

- `src/domain/**` stays framework-free (plain-Node suite).
- No schema change; `occurrenceDate`/`occurredAt` stay epoch-ms columns. (A
  date-only `YYYY-MM-DD` column would be the more robust long-term identity but
  is a larger migration — explicitly OUT of scope here.)
- No behavioural change to which occurrences fire or to dedup — only the stored
  instant's time-of-day and the timezone in which "which day" is computed.

## Edge cases

- **DST transition** (e.g. a weekly series spanning a spring-forward): each
  occurrence re-normalized to local noon → still the correct local day.
- **In-flight soak series** anchored midnight-UTC: on first run under the new
  engine, `localDayNoon` maps the stored instant to its local day's noon. In
  UTC+8 that's the same calendar day (no shift); in UTC-negative zones an
  existing anchor may move back one day. Acceptable one-time blip on soak data;
  `lastPostedAt` normalization prevents double-posting. Note it in the PR.
- **Month-end** (31st monthly in a 30-day month): existing `Math.min(day,
  lastDay)` clamp preserved under the local constructor.
- **`until` end dates** set from the RepeatSheet: normalized the same way, so
  an inclusive end-day comparison stays inclusive in local time.
