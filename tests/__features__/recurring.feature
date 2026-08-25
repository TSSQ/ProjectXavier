Feature: Recurring transactions
  A series generates real transaction rows on each due date. The scheduling
  logic is deterministic and framework-free so it can be exhaustively tested
  in plain Node without a database.

  # ── nextOccurrenceAfter ────────────────────────────────────────────────────

  Scenario: Daily rule produces consecutive occurrences
    Given a daily rule anchored on "2026-01-01" with interval 1
    When I ask for the next occurrence after "2026-01-01"
    Then the result should be "2026-01-02"
    When I ask for the next occurrence after "2026-01-04"
    Then the result should be "2026-01-05"

  Scenario: Weekly rule steps by 7 days
    Given a weekly rule anchored on "2026-01-05" with interval 1
    When I ask for the next occurrence after "2026-01-05"
    Then the result should be "2026-01-12"

  Scenario: Bi-weekly rule steps by 14 days
    Given a weekly rule anchored on "2026-01-05" with interval 2
    When I ask for the next occurrence after "2026-01-05"
    Then the result should be "2026-01-19"

  Scenario: Monthly rule on the 1st advances one calendar month
    Given a monthly rule anchored on "2026-01-01" with interval 1
    When I ask for the next occurrence after "2026-01-01"
    Then the result should be "2026-02-01"

  Scenario: Monthly rule on the 31st clamps to February 28 in non-leap year
    Given a monthly rule anchored on "2026-01-31" with interval 1
    When I ask for the next occurrence after "2026-01-31"
    Then the result should be "2026-02-28"

  Scenario: Semi-annual rule steps by 6 months
    Given a monthly rule anchored on "2026-01-01" with interval 6
    When I ask for the next occurrence after "2026-01-01"
    Then the result should be "2026-07-01"

  Scenario: Yearly rule steps by one year
    Given a yearly rule anchored on "2026-03-15" with interval 1
    When I ask for the next occurrence after "2026-03-15"
    Then the result should be "2027-03-15"

  # ── dueOccurrences ─────────────────────────────────────────────────────────

  Scenario: Due occurrences returns all dates between last post and now
    Given a monthly series anchored on "2026-01-01" with no last post and today is "2026-03-20"
    Then due occurrences should be "2026-01-01", "2026-02-01", "2026-03-01"

  Scenario: Due occurrences respects the last posted date
    Given a monthly series anchored on "2026-01-01" last posted on "2026-02-01" and today is "2026-04-10"
    Then due occurrences should be "2026-03-01", "2026-04-01"

  Scenario: Count-limited series stops after N occurrences
    Given a monthly series anchored on "2026-01-01" limited to 3 occurrences with 2 already posted and today is "2026-05-01"
    Then due occurrences should be "2026-03-01"

  Scenario: Until-limited series stops on or before the end date
    Given a monthly series anchored on "2026-01-01" ending until "2026-03-15" with no last post and today is "2026-06-01"
    Then due occurrences should be "2026-01-01", "2026-02-01", "2026-03-01"

  Scenario: Paused series produces no due occurrences
    Given a paused monthly series anchored on "2026-01-01" with no last post and today is "2026-06-01"
    Then due occurrences should be empty

  Scenario: Skipped date is excluded from due occurrences
    Given a monthly series anchored on "2026-01-01" with "2026-02-01" skipped and no last post and today is "2026-03-10"
    Then due occurrences should be "2026-01-01", "2026-03-01"

  # ── forecastNetWorth ────────────────────────────────────────────────────────

  Scenario: Forecast adds future income occurrences to actual net worth
    Given an actual net worth of 100000 minor units
    And a monthly income series of 50000 with next occurrence "2026-07-01"
    When I forecast net worth from "2026-06-25" until "2026-08-01"
    Then the forecast should be 150000 minor units

  Scenario: Forecast subtracts future expense occurrences
    Given an actual net worth of 100000 minor units
    And a monthly expense series of 20000 with next occurrence "2026-07-01"
    When I forecast net worth from "2026-06-25" until "2026-08-01"
    Then the forecast should be 80000 minor units

  Scenario: Transfer occurrences are net-worth-neutral in forecast
    Given an actual net worth of 100000 minor units
    And a monthly transfer series of 30000 with next occurrence "2026-07-01"
    When I forecast net worth from "2026-06-25" until "2026-08-01"
    Then the forecast should be 100000 minor units

  # ── splitSeriesAt ───────────────────────────────────────────────────────────

  Scenario: Splitting a series truncates the original and creates a continuation
    Given a monthly series anchored on "2026-01-01" with no end
    When I split the series at "2026-04-01" with a new template
    Then the truncated series should end before "2026-04-01"
    And the continuation should be anchored on "2026-04-01"
    And the continuation should have a different id

  Scenario: Splitting a series before the split occurrence posts does not double-post it
    Given a monthly series anchored on "2026-01-01" with no end
    When I split the series at "2026-04-01" with a new template
    Then due occurrences for the truncated series as of "2026-04-01" should not include "2026-04-01"
    And due occurrences for the continuation series as of "2026-04-01" should include "2026-04-01"

  # ── resolveTemplateForPosting (review F2) ──────────────────────────────────
  # Auto-posting must classify a stored template without throwing, so one bad
  # series (a legacy self-transfer template, or genuine corruption reachable
  # via the unvalidated legacy .json restore) can never halt posting for every
  # OTHER series.

  Scenario: A healthy template is postable
    Given a stored template that is a normal expense
    Then resolveTemplateForPosting should say it is postable

  Scenario: A self-transfer template is skipped, not thrown
    Given a stored template that is a transfer with the same account on both sides
    Then resolveTemplateForPosting should skip it for reason "self-transfer"

  Scenario: A genuinely corrupt template is skipped, not thrown
    Given a stored template missing its accountId
    Then resolveTemplateForPosting should skip it for reason "invalid"

  Scenario: One bad template in a batch does not affect the others
    Given a batch of templates where one is a self-transfer and the rest are healthy
    Then only the healthy templates in the batch should be postable

  # A never-ending series has no natural stopping point, so `upcomingOccurrences`
  # was bounded only by its `limit`. The dashboard's 30-day forecast passed
  # 10,000 — generating occurrences into the year 2859 for a monthly rule, and
  # doing it quadratically, because monthly `nextOccurrenceAfter` re-walks from
  # the anchor on every call. Measured at 9.7s per series on a Mac, synchronous
  # on the JS thread: the app renders nothing and accepts no touches.
  Scenario: Upcoming occurrences stop at the requested date bound
    Given a "monthly" series anchored at local "2026-08-25" that never ends
    When I list upcoming occurrences from local "2026-08-18" until local "2026-09-18" with limit 10000
    Then there should be 1 upcoming occurrence
    And the last upcoming occurrence should be before the bound

  Scenario: A date bound applies to a series anchored in the past too
    Given a "monthly" series anchored at local "2026-07-25" that never ends
    When I list upcoming occurrences from local "2026-08-18" until local "2026-12-18" with limit 10000
    Then there should be 4 upcoming occurrences
    And the last upcoming occurrence should be before the bound

  Scenario: Without a bound the limit still applies
    Given a "monthly" series anchored at local "2026-08-25" that never ends
    When I list upcoming occurrences from local "2026-08-18" with limit 3
    Then there should be 3 upcoming occurrences

  # Only monthly and yearly actually blew up — their nextOccurrenceAfter walks
  # from the anchor on every call, so generating N occurrences costs O(N²)
  # (9.6s and 9.2s at N=10,000). Daily and weekly compute the step count
  # arithmetically and were ~3ms. The bound is what every frequency relies on
  # now, so all four are covered here rather than only the two that hurt.
  Scenario Outline: Every frequency respects the date bound
    Given a "<freq>" series anchored at local "2026-08-25" that never ends
    When I list upcoming occurrences from local "2026-08-18" until local "2026-09-18" with limit 10000
    Then there should be <count> upcoming occurrences
    And the last upcoming occurrence should be before the bound

    Examples:
      | freq    | count |
      | daily   | 24    |
      | weekly  | 4     |
      | monthly | 1     |
      | yearly  | 1     |

  # The Upcoming strip and the Recurring screen render the SERIES, not its
  # ledger rows, and both titled it by template.type — so a Netflix
  # subscription read "Netflix" in the ledger and "Expense" in the two places
  # whose job is telling you what is coming.
  Scenario: A series is titled by its payee
    When I title a series with payee "Netflix" and category "Subscription"
    Then the series title should be "Netflix"

  Scenario: A series with no payee falls back to its category
    When I title a series with payee "" and category "Subscription"
    Then the series title should be "Subscription"

  Scenario: A series with neither falls back to the type
    When I title a series with payee "" and category ""
    Then the series title should be "Expense"

  Scenario: Whitespace-only names do not count as a title
    When I title a series with payee "   " and category "  "
    Then the series title should be "Expense"

  # A rule that cannot advance used to spin the monthly/yearly walk for ever —
  # an infinite loop on the JS thread, reached on app launch (postDueOccurrences)
  # and on every render of the Planned/Upcoming lists. recurrenceRuleSchema
  # rejects interval < 1 on every WRITE, but rowToSeries does not validate on
  # read, so a legacy or restored row can still carry one.
  Scenario Outline: A rule that cannot advance schedules nothing instead of hanging
    Given a "<freq>" rule with interval <interval>
    When I ask for the next occurrence
    Then there should be no next occurrence

    Examples:
      | freq    | interval |
      | monthly | 0        |
      | yearly  | 0        |
      | daily   | 0        |
      | weekly  | 0        |
      | monthly | -1       |

  Scenario: A normal interval still advances
    Given a "monthly" rule with interval 1
    When I ask for the next occurrence
    Then there should be a next occurrence

  # Clean-up half of the back-posting bug: rows already written are not undone
  # by fixing the cause. Acting on this DELETES financial data, so the
  # predicate is narrow and every row it must NOT touch is pinned here —
  # those are the scenarios that matter, not the two that flag.
  Scenario Outline: Only occurrences invented before the series existed are flagged
    Given a monthly series created on "2026-08-23" anchored "2025-08-04"
    When I check a posted row "<case>"
    Then it should be <verdict>

    Examples:
      | case                          | verdict |
      | phantom dated Sep 2025        | flagged |
      | phantom dated Jan 2026        | flagged |
      | the anchor the user typed     | kept    |
      | a normal future occurrence    | kept    |
      | posted late, clock was wrong  | kept    |
      | the user edited the amount    | kept    |
      | the user edited the payee     | kept    |
      | the user edited the note      | kept    |
      | a row from another series     | kept    |
      | a manual row tagged to series | kept    |
      | a row in no series at all     | kept    |
      | written after the batch window | kept   |

  # ── the forecast window ───────────────────────────────────────────────────
  # Balances now stop at today (settledBy), so anything dated ahead has to
  # show up here or it appears nowhere but the Upcoming list. The projection
  # therefore counts one-off future-dated rows as well as scheduled
  # occurrences — and must not count a recurring entry twice, now that such an
  # entry writes its first occurrence as a real row AND has a series that
  # would project the same date.

  Scenario: A one-off future-dated expense counts toward the forecast
    Given today is "2026-08-23" and the window runs 30 days
    And a one-off expense of 21.19 dated "2026-08-25"
    When I total what is upcoming
    Then outgoing should be 2119
    And incoming should be 0

  Scenario: A one-off future-dated income counts toward the forecast
    Given today is "2026-08-23" and the window runs 30 days
    And a one-off income of 3200.00 dated "2026-09-01"
    When I total what is upcoming
    Then incoming should be 320000
    And outgoing should be 0

  Scenario: A row dated beyond the window is not counted
    Given today is "2026-08-23" and the window runs 30 days
    And a one-off expense of 21.19 dated "2026-12-01"
    When I total what is upcoming
    Then outgoing should be 0

  Scenario: A past row is not counted
    Given today is "2026-08-23" and the window runs 30 days
    And a one-off expense of 21.19 dated "2026-08-01"
    When I total what is upcoming
    Then outgoing should be 0

  # Transfers move money between the user's own accounts.
  Scenario: A future-dated transfer does not move the forecast
    Given today is "2026-08-23" and the window runs 30 days
    And a one-off transfer of 230.77 dated "2026-08-30"
    When I total what is upcoming
    Then outgoing should be 0
    And incoming should be 0

  Scenario: A recurring entry already written as a row is counted once
    Given today is "2026-08-23" and the window runs 30 days
    And a monthly series of 139.36 anchored "2026-08-25" whose first occurrence is already a row
    When I total what is upcoming
    Then outgoing should be 13936

  Scenario: The manage screen lists the soonest due first
    Given today is "2026-08-25"
    And a series "Apple Music" due "2026-09-24"
    And a series "Parents" due "2026-09-01"
    And a series "IRAS" due "2026-09-06"
    And a series "Aviva" due "2026-09-10"
    When I sort the series for the manage screen
    Then the order should be "Parents, IRAS, Aviva, Apple Music"

  Scenario: A series with nothing left to fire sorts last
    Given today is "2026-08-25"
    And a series "Apple Music" due "2026-09-24"
    And a series "Finished" that has no occurrences left
    And a series "Parents" due "2026-09-01"
    When I sort the series for the manage screen
    Then the order should be "Parents, Apple Music, Finished"

  Scenario: Series due the same day keep their creation order
    Given today is "2026-08-25"
    And a series "Apple Music" due "2026-09-24"
    And a series "iCloud+" due "2026-09-24"
    When I sort the series for the manage screen
    Then the order should be "Apple Music, iCloud+"
