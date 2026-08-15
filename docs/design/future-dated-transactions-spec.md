# Spec: future-dated transactions and future-starting recurring series

**Branch:** `claude/phase2-byok` · **Status:** design · **Date:** 2026-08-05

## 1. Objective

Let a user record a transaction dated in the future (a bill due next week, a booked flight) and start a recurring series that begins in the future — **without those amounts polluting what they have actually spent.**

**Product decision (made, not open): a future-dated transaction does NOT count toward the current period's totals.** It becomes countable when its date arrives.

## 2. What already works (verified — this is smaller than it looks)

- **The storage layer allows a future date.** `transactionSchema` has `occurredAt: z.number().int()` with no upper bound, so a future-dated row saves and round-trips.
- **CORRECTION (found during implementation — this section was wrong).** The spec originally claimed "nothing blocks a future date" on the strength of `TransactionFormSheet` setting no `maximumDate`. That was true of `TransactionFormSheet` and false of the app: the shared `src/components/ui/DateField.tsx` hard-coded `maximumDate={new Date()}` on **both** its Android and iOS `DateTimePicker` instances, which is what actually blocked future dates. Removed during implementation. The lesson is the grep, not the fact — I checked the screen that owns the field rather than the component that renders it.
- **Bonus defect found by the same fix:** `RepeatSheet`'s "end repeat on date" field defaults to roughly `now + 365 days` but shares `DateField`, so it was **unusable in its own default direction** — the picker refused every date it was pre-set to. Unrelated to future-dating; fixed by the same one-line removal.
- **`app/recurring.tsx` has no anchor picker at all** — it is pure management (pause/resume/skip/delete) of existing series. A new series' anchor comes from the transaction date field via `RepeatSheet`, so `DateField` was the only thing to fix.
- **Recurring already supports a future start.** `nextOccurrenceAfter` returns the anchor itself when the cursor is earlier than the anchor, so a series anchored next month simply fires next month.

So the capability largely exists. **The gap is policy and presentation, not storage.**

## 3. The correctness trap this spec exists to close

`inRange` is a pure timestamp comparison:

```ts
return tx.occurredAt >= range.start && tx.occurredAt < range.end;
```

"This month" runs to the end of the month. So a transaction dated the 25th, entered on the 5th, **immediately counts in this month's spending** — the dashboard reports money that has not been spent.

Meanwhile `netWorthAsOf` uses `accountBalanceAsOf`, which is bounded by `asOf`, so **net worth as of today correctly ignores it**.

That means, today, the two headline numbers on the same screen disagree about the same row: spending includes it, net worth does not. Under decision (a) they agree, and the fix is to make the *spending* side behave the way net worth already does.

## 4. Approach

### 4.1 Extend the existing "recorded but not counted" concept

The app already models this: `isCounted(tx) = !tx.pending`, and pending rows are excluded from every aggregation while staying visible in the ledger with a chip. Future-dating is the same idea with an automatic, date-driven trigger rather than a manual flag.

**Change `isCounted` to take the clock:**

```ts
export const isCounted = (tx: Transaction, now: number): boolean =>
  !tx.pending && tx.occurredAt <= now;
```

- **`now` is injected, never read inside the module.** This is the house rule (`CloudParseContext.now` carries the same comment) and it is what makes the behaviour testable in the plain-Node suite.
- **No schema change.** No new column, no migration, no backup-format change. "Future" is derived from data we already store, so it cannot drift, cannot be forgotten on restore, and cannot disagree with the date shown on the row.
- Deliberately **not** a `scheduled` boolean: a stored flag would need a job to flip it, and would be wrong the moment the device clock crossed midnight without the app running.

Every current `isCounted` caller must pass `now`: `totalsForRange`, the bucketing in `period.ts`, `categoryBreakdown`, `signedDelta` (and therefore `accountBalance`/`netWorth`), the widget summary, and the query tools. **Making the signature require it is the point** — a caller that forgets will not compile, so no aggregation can silently keep counting the future.

### 4.2 What each surface should then show

| Surface | Behaviour |
| --- | --- |
| Period totals, charts, category donut | **Exclude** future rows |
| Net worth (headline + as-of) | **Exclude** — already does; now consistent with spending |
| Widget | **Exclude** |
| Ask-Xavier query tools | **Exclude** — "how much did I spend" must not include the future |
| Transactions tab / account detail | **Show**, with an "Upcoming" chip, exactly as `pending` is shown today |

### 4.3 Surfacing upcoming money without lying about spending

Excluding it entirely and saying nothing is its own failure — the user entered the row *because* they want to see it coming. Minimum viable disclosure:

- An **"Upcoming" chip** on future rows in the ledger, reusing the visual treatment `pending` already has (`TransactionRow` renders a chip and dims the amount).
- On the account detail screen, an **upcoming count/total line** ("3 upcoming · SGD 240") separate from the balance, never folded into it.

A full "committed vs actual" dashboard split is **out of scope** — see §6.

### 4.4 Entry points

- **Form:** allow future dates (already possible); no `maximumDate`. Nothing to change beyond confirming the picker permits it.
- **Assistant:** the parse contract already extracts dates. `resolveRelativeDate` handles "tomorrow"/"next Friday" if those tokens are supported — **verify, and add corpus cases before touching the resolver** (the standing rule).
- **Recurring:** allow an anchor in the future in the UI. The domain already handles it; confirm `app/recurring.tsx` doesn't clamp the picker to today.

## 5. Acceptance criteria

Plain-Node BDD (`tests/`), all with an injected clock:

1. `isCounted(tx, now)` is false when `tx.occurredAt > now`, true when equal or earlier, and still false for any `pending` row regardless of date.
2. `totalsForRange` over a range containing a future-dated row **excludes** it; the same row counted once `now` passes its date.
3. The category donut and the time buckets exclude it.
4. `accountBalance` / `netWorth` exclude it; `netWorthAsOf` behaviour is **unchanged** (it already excluded it) — asserted as a regression, since this spec must not alter a number that was already right.
5. The widget summary excludes it.
6. Every Ask-Xavier query tool excludes it — in particular `total_spent` for "this month" with a future row inside the month.
7. A transaction dated exactly `now` **is** counted (boundary: `<=`, not `<`).
8. A recurring series anchored in the future posts nothing until the anchor arrives, then posts normally.
9. Backup → restore round-trips a future-dated row unchanged, and it remains uncounted (no stored flag to go stale).

Device:

10. A future-dated row shows an "Upcoming" chip in the ledger and does not move any total.
11. The same row starts counting the day its date arrives, with no user action.

## 6. Out of scope

- A "committed vs actual" dashboard split, forecast lines, or an upcoming-bills screen.
- Notifications/reminders for upcoming transactions.
- Any change to how `pending` works.
- Auto-converting an upcoming row to pending or vice versa.

## 7. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A missed `isCounted` caller keeps counting the future | High | Make `now` a **required** parameter — a missed caller fails typecheck rather than shipping a wrong number. |
| Users think the app "lost" a transaction they entered | Medium | The "Upcoming" chip and the account-detail upcoming line. It stays visible in the ledger; only the totals ignore it. |
| Timezone/midnight boundary | Medium | Compare against the injected `now`, and reuse the existing local-noon day handling in `src/domain/dates.ts` rather than inventing a comparison. Cover the boundary explicitly (criterion 7). |
| A long-running session crosses midnight and totals go stale | Low | Screens already refresh on focus. Acceptable; note it rather than adding a timer. |
| Existing data changes meaning | Low | Any already-saved future-dated row stops counting after this ships. That is the intended correction, but it means a user's totals can move on upgrade — worth a release note. |

## 8. Open questions

1. **Should the assistant be able to create future-dated transactions in v1**, or only the manual form? Chat introduces date-extraction risk ("next Friday") that the form does not. Leaning form-first, with chat behind corpus cases.
2. **Does the account detail balance include upcoming rows?** Recommended no, with a separate upcoming line — but that is a UX call worth confirming on device.
