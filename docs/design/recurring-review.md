# Recurring transactions — subsystem review

**Date:** 2026-08-23 · **Reviewed at:** `224faa0` · **Live on the App Store:** v1.1.1 (build 74 = `07c112e`)

Prompted by six recurring-related defects in a week. The question worth
answering was not "what is the next bug" but "why does this area keep
producing them".

## The shape of the subsystem

| layer | file | lines | state |
|---|---|---|---|
| pure engine | `src/domain/recurrence.ts` | 529 | well-tested, framework-free |
| persistence + posting | `src/features/recurring/repository.ts` | 355 | where the edges leak |
| management screen | `app/recurring.tsx` | 224 | pause / skip / delete only |
| rule picker | `src/components/ui/RepeatSheet.tsx` | 325 | fixed presets, create-only |

The engine is the healthy part: pure, injected clock, covered by the
plain-Node suite. **Every defect this week landed at an edge** — an
unvalidated read, an unbounded loop on a hot path, or a screen re-deriving
presentation instead of sharing it.

## One root cause behind three separate bugs

A new or continued series was created with `lastPostedAt: null`, and
`dueOccurrences` treats null as "start a day before the anchor". That
conflates two different things:

> "this series has posted nothing yet" ≠ "this series should post everything
> since its start date"

That single conflation produced:

- **back-posting** — a subscription entered with its real start date posted
  every month since (13 rows, SGD 1,811.68 measured for a one-year-old start
  date). Fixed in `bed476f`; **not yet released**.
- ~~**`splitSeriesAt`'s continuation** sets `lastPostedAt: null` too, so the
  moment it is wired to UI it will back-post from the split date.~~
  **Wrong — corrected 2026-08-23 when wiring it.** `dueOccurrences` reads null
  as "start a day before the anchor", and the continuation's anchor IS the
  split point, so nothing back-posts and the split occurrence still posts when
  it falls due (verified). The pattern is only dangerous when the anchor is far
  in the PAST, which is why `buildRecurringSeries` needed the cursor and this
  does not: the UI splits at the next upcoming occurrence.
- the same pattern is what `resumeSeriesForAccount` exists to work around at
  unarchive, described in its own header as "back-post the ENTIRE archived
  gap in one go".

Three symptoms, one idea. Worth stating as an invariant: **a series must never
post an occurrence dated before the moment it was created or resumed.**

## Findings

### P0 — live on the App Store right now

| # | finding | status |
|---|---|---|
| 1 | Back-dated recurring entry posts its whole history on save, silently inflating the balance | fixed `bed476f`, unreleased |
| 2 | A rule that cannot advance (`interval: 0`, monthly/yearly) spins `while (true)` forever — on the launch path via `postDueOccurrences` and on every Planned/Upcoming render | fixed `224faa0`, unreleased |
| 3 | Dashboard PLANNED titles rows by bare type ("Expense") | fixed `bed476f`, unreleased |

(1) is the serious one: it is a money bug, it is silent, and it is in users'
hands. It also does not self-heal — rows already posted stay posted, so
affected users need to delete them by hand.

### P1 — a capability that was never wired up

**4. A series cannot be edited at all.** *(Done 2026-08-23 — pencil on the
Recurring screen, via Dashboard › Manage. Applies from the next occurrence
onward; `splitAndContinue` gained a `newRule` parameter, without which it
could change the amount but not the schedule.)* The management screen offers
pause/resume, skip-next and delete. There is no way to change an amount, an
account, a category or the schedule. Changing a subscription price means
deleting the series and rebuilding it.

The machinery for this already exists and is unreachable:

- `splitSeriesAt` (pure, documented, has BDD coverage) — truncates the old
  series and starts a continuation from a given occurrence, which is exactly
  "change this from here onward".
- `splitAndContinue` (repository) — the DB write around it.

Neither has a single caller. So the feature was designed and built to the
data layer and then never surfaced. Any edit work should start here rather
than inventing a second mechanism — **after** fixing the `lastPostedAt: null`
in the continuation.

### P2 — structural, not yet biting

**5. "Delete" does not delete.** `app/recurring.tsx` sets `archived: true`;
`deleteSeries` has no callers. Archived series accumulate with no purge and
no UI to see or restore them. Defensible as a soft delete, but then the
button should not say "Delete", and something should eventually reclaim them.

**6. No validation on read.** `rowToSeries` `JSON.parse`s `rule` and
`template` with no schema check, while every write goes through
`recurringSeriesSchema.parse`. So corruption can only enter via a restore —
which is precisely the path this file's own comments call out as unvalidated
— and then flows straight into the engine. Finding (2) is only reachable this
way.

Worse, `listSeries()` is called on the **first line** of `postDueOccurrences`,
outside the per-series `try`. The careful per-series error isolation below it
is defeated by one unparseable row, which would take down posting for every
series on every launch.

**7. Posting is unbounded and row-at-a-time.** `postDueOccurrences` issues one
`SELECT` and one `INSERT` per due occurrence. With a far-behind cursor — which
is exactly what finding (1) creates — a launch can mean hundreds of round
trips before the splash clears, which is indistinguishable from a hang. There
is no cap and no batching.

**8. Occurrence/template desync.** Editing a posted occurrence changes only
that row; the template is untouched, and there is no "apply to future". This
is reasonable behaviour but undiscoverable, and it is the other half of (4).

### Dead code

`splitSeriesAt`, `splitAndContinue`, `deleteSeries`, `getSeriesById` — no
callers. ~150 lines, some of it tested. Recommend wiring (the first two, for
editing) rather than deleting, since they are the design for the missing
feature.

## The pattern worth fixing

1. **Edges, not the engine.** The pure layer has an injected clock and real
   coverage. The repository does I/O in loops, parses without validating, and
   its one unguarded call defeats its own error isolation. That is where the
   next bug will come from too.
2. **Presentation re-derived per screen.** The "Expense" naming bug existed in
   three places because three screens each wrote their own title expression.
   Fixed by one shared helper — the same treatment is owed to the icon/tone
   ternaries, which are still duplicated in all three.
3. **Unbounded loops on hot paths.** Two of this week's freezes were loops
   with no date bound, both reached on launch or on every render. `while
   (true)` appears four times in the engine; each now has a bound or a guard,
   but nothing structurally prevents the fifth.

## Suggested order

1. **Ship (1) — a build with the back-posting fix.** It is a silent money bug
   in a released app. Everything else can wait for that.
2. Tell affected users how to clean up: the posted rows do not disappear on
   update.
3. Wire editing via `splitSeriesAt`, fixing its `lastPostedAt: null` first.
4. Validate on read, and move `listSeries()` inside the guard.
5. Batch the posting insert, or cap a single catch-up run.
