Feature: The widget refresh is one cheap query, coalesced, and skipped when nothing shows differently
  The widget summary used to re-read the whole ledger on every save and
  rewrite the widget even when its numbers hadn't moved (issue #27).

  Scenario Outline: The SQL window counts exactly what the dashboard counts
    Given today is "<today>"
    And a ledger with rows around the month and day boundaries
    When the rows are filtered by the widget's counted window
    Then the income and expense match the dashboard's month totals

    Examples:
      | today               |
      | 2026-09-30T10:00:00 |
      | 2026-09-01T00:00:00 |
      | 2026-09-15T23:59:59 |
      | 2026-12-31T18:00:00 |

  Scenario: On the last day of a month the window ends at the next month
    Given today is "2026-09-30T10:00:00"
    Then the window should run from 1 September to 1 October

  Scenario: Only what the widget draws counts as a change
    Given a widget summary
    Then changing only updatedAt should keep the same key
    And changing the income, expense, currency or month label should each change the key

  Scenario: A burst of saves refreshes once
    Given a debounced refresh with a 1500 ms wait
    When it is scheduled 5 times 100 ms apart
    Then it should not have run yet
    When 1500 ms pass
    Then it should have run 1 time

  Scenario: Cancelling drops the scheduled run
    Given a debounced refresh with a 1500 ms wait
    When it is scheduled 1 times 100 ms apart
    And it is cancelled
    And 1500 ms pass
    Then it should have run 0 times
