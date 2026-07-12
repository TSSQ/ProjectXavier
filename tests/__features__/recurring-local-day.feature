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
