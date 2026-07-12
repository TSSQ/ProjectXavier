Feature: Date helpers
  Dates are displayed as dd-MM-yyyy, and "today" is decided by local calendar
  day so the assistant feed scopes to the current day correctly.

  Scenario: Format a date as dd-MM-yyyy
    Given the date 2026-06-24 at 09:30 local
    When I format it for display
    Then the formatted date should be "24-06-2026"

  Scenario: Two times on the same calendar day are the same day
    Given a first date 2026-06-24 at 00:05 local
    And a second date 2026-06-24 at 23:55 local
    Then the two dates should be the same day

  Scenario: Times either side of midnight are different days
    Given a first date 2026-06-24 at 23:55 local
    And a second date 2026-06-25 at 00:05 local
    Then the two dates should not be the same day

  Scenario: Month label for the widget summary
    Given the date 2026-07-06 at 10:00 local
    When I compute its month label
    Then the month label should be "July 2026"

  Scenario: Local-noon day identity is stable across the day
    Given a first date 2026-06-24 at 00:05 local
    And a second date 2026-06-24 at 23:55 local
    When I compute the local-noon identity of both dates
    Then both local-noon identities should be 2026-06-24 at 12:00 local
    And both local-noon identities should be equal
