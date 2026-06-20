Feature: Time-period drill-down
  Users can view totals for a chosen day, month, or year.

  Background:
    Given the following transactions:
      | type    | amount | date       |
      | expense | 10.00  | 2026-01-05 |
      | expense | 20.00  | 2026-01-20 |
      | income  | 100.00 | 2026-01-20 |
      | expense | 5.00   | 2026-02-03 |

  Scenario: Monthly expense total
    When I view totals for "month" of "2026-01"
    Then the expense total should be 30.00
    And the income total should be 100.00
    And the net total should be 70.00

  Scenario: Daily drill-down
    When I view totals for "day" of "2026-01-05"
    Then the expense total should be 10.00

  Scenario: Yearly total
    When I view totals for "year" of "2026"
    Then the expense total should be 35.00
