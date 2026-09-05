Feature: Recurring occurrences post on the intended local calendar day

  Regression coverage for assessment H3: the recurrence engine used to key
  occurrences on midnight-UTC, which renders on the wrong local calendar day
  (and sometimes the wrong local month) once `occurredAt` is read back with
  local getters, as the rest of the app does. These scenarios build their
  dates from the local Date constructor (not UTC) so they exercise the bug
  directly, and must pass unmodified under every timezone the suite is run
  in (see package.json's "test:tz" script).

  Scenario: Daily series anchored on local today posts on the intended local days
    Given a daily series anchored at local "2026-03-10 08:15" with interval 1
    When I compute due occurrences as of local "2026-03-12 21:45"
    Then the due occurrences' local calendar days should be "2026-03-10", "2026-03-11", "2026-03-12"

  Scenario: Weekly series posts on the intended local day in both zones
    Given a weekly series anchored at local "2026-06-01 08:15" with interval 1
    When I compute due occurrences as of local "2026-06-22 21:45"
    Then the due occurrences' local calendar days should be "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"

  Scenario: Monthly series on the 1st posts in the intended local month
    Given a monthly series anchored at local "2026-01-01 08:15" with interval 1
    When I compute due occurrences as of local "2026-03-02 21:45"
    Then the due occurrences' local calendar days should be "2026-01-01", "2026-02-01", "2026-03-01"

  # ── DST spring-forward guard ────────────────────────────────────────────────
  # A noon-to-noon span across a spring-forward day is only 23h. Fixed-ms
  # stepping (anchorDay + n * step) can compute the same `n` on both sides of
  # the transition, so nextOccurrenceAfter never advances and dueOccurrences'
  # while loop hangs forever — which hangs app launch, since postDueOccurrences
  # runs there. These scenarios must return promptly (guarded by a test
  # timeout) with no drift and no duplicate day. Meaningful under
  # TZ=America/New_York (a DST zone); trivially safe under UTC/Singapore
  # (no DST), so they're still expected to pass there.

  Scenario: Daily series survives a spring-forward transition without stalling
    Given a daily series anchored at local "2026-03-05 08:15" with interval 1
    When I compute due occurrences as of local "2026-03-11 21:45"
    Then the due occurrences' local calendar days should be "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11"

  Scenario: Weekly series survives a spring-forward transition without stalling
    Given a weekly series anchored at local "2026-02-15 08:15" with interval 1
    When I compute due occurrences as of local "2026-03-15 21:45"
    Then the due occurrences' local calendar days should be "2026-02-15", "2026-02-22", "2026-03-01", "2026-03-08", "2026-03-15"

  # ── DST fall-back guard ──────────────────────────────────────────────────────
  # Belt-and-suspenders coverage for the other DST edge: a noon-to-noon span
  # across the fall-back day is 25h (not 24h). addLocalDays is calendar-day
  # arithmetic, so this is expected to pass immediately, but it guards the same
  # area that failed QA once.

  Scenario: Daily series survives a fall-back transition without stalling
    Given a daily series anchored at local "2026-10-29 08:15" with interval 1
    When I compute due occurrences as of local "2026-11-03 21:45"
    Then the due occurrences' local calendar days should be "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"

  # buildRecurringSeries — the shared constructor behind every screen that can
  # start a series. Three screens now can (the transactions FAB, the
  # assistant's confirm-card editor); before this it was inline in one of
  # them, so the parts below could be got wrong independently.
  Scenario: A new series anchors to the transaction's local day at noon
    When I build a recurring series for a transaction at local time 2026-08-18 21:40
    Then the series anchor should be local noon on 2026-08-18

  Scenario: A new series anchors to noon even for an early-morning transaction
    When I build a recurring series for a transaction at local time 2026-08-18 00:10
    Then the series anchor should be local noon on 2026-08-18

  # A series that starts paused, pre-posted or archived silently never fires.
  # The anchor occurrence is the transaction the user just entered, so the
  # series starts having ALREADY accounted for it. Starting un-posted meant a
  # series dated in the past immediately back-posted every occurrence between
  # then and today: a monthly subscription entered with a start date one year
  # ago posted 13 charges at once, silently, and the account balance moved by
  # 13x what the user typed.
  Scenario: A new series counts its anchor occurrence as already recorded
    When I build a recurring series for a transaction at local time 2026-08-18 09:00
    Then the series cursor should sit on the anchor
    And the series should have counted one occurrence
    And the series should not be paused
    And the series should have no skipped dates
    And the series should not be archived

  Scenario: A series created today but dated a year ago back-posts nothing
    When I create a monthly series on local "2026-08-23" dated local "2025-08-04" and post it as of local "2026-08-23"
    Then no occurrences should be posted

  Scenario: A series created and dated today back-posts nothing
    When I create a monthly series on local "2026-08-23" dated local "2026-08-23" and post it as of local "2026-08-23"
    Then no occurrences should be posted

  # The schedule itself must still work — this is a back-posting fix, not a
  # "recurring transactions stop recurring" fix.
  Scenario: The next occurrence still posts when it comes due
    When I create a monthly series on local "2026-08-04" dated local "2026-08-04" and post it as of local "2026-09-04"
    Then 1 occurrence should be posted

  # The anchor keeps the schedule's shape even when the cursor starts later:
  # a subscription that has always billed on the 4th keeps billing on the 4th.
  Scenario: A back-dated series keeps its original day of the month
    When I create a monthly series on local "2026-08-23" dated local "2025-08-04" and post it as of local "2026-09-30"
    Then 1 occurrence should be posted
    And it should fall on day 4 of the month

  Scenario: A new series keeps the rule's own frequency and interval
    When I build a recurring series for a transaction at local time 2026-08-18 09:00
    Then the series rule should keep its frequency and interval

  Scenario: A new series carries the template through unchanged
    When I build a recurring series for a transaction at local time 2026-08-18 09:00
    Then the series template should carry the account, amount and note unchanged

  # ── back-dating is a question, not a default ─────────────────────────────
  # Creating the months since a past start date silently is how one entry
  # became thirteen rows; creating none silently hides charges the user
  # believes are recorded. The screen asks, and passes the answer through.

  Scenario: Backfilling a back-dated series creates the months since
    When I create a monthly series on local "2026-08-23" dated local "2026-04-04", backfilling, and post it as of local "2026-08-23"
    Then 4 occurrences should be posted

  Scenario: Declining leaves the history alone
    When I create a monthly series on local "2026-08-23" dated local "2026-04-04" and post it as of local "2026-08-23"
    Then no occurrences should be posted

  # What the prompt counts must equal what appears if the user says yes.
  Scenario: The prompt counts the same occurrences it would create
    When I count the backfill for a monthly series dated local "2026-04-04" as of local "2026-08-23"
    Then the backfill count should be 4

  Scenario: A series starting today has nothing to ask about
    When I count the backfill for a monthly series dated local "2026-08-23" as of local "2026-08-23"
    Then the backfill count should be 0

  Scenario: A series starting in the future has nothing to ask about
    When I count the backfill for a monthly series dated local "2026-09-04" as of local "2026-08-23"
    Then the backfill count should be 0
