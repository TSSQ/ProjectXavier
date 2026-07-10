Feature: Dashboard category-breakdown donuts
  categoryBreakdown sums a period's expense/income transactions by category
  for the dashboard's donut charts, sorted by amount descending. Transfers
  never appear (the type filter only matches expense/income) and pending
  transactions are excluded, like every other money total.

  Scenario: Slices sum by category and sort by amount descending
    Given the following transactions in "2026-01":
      | type    | category  | amount | pending |
      | expense | groceries | 30.00  | no      |
      | expense | transport | 50.00  | no      |
      | expense | groceries | 25.00  | no      |
    When I compute the expense category breakdown for "2026-01"
    Then the breakdown should have 2 slices
    And slice 1 should be category "groceries" with amount 55.00
    And slice 2 should be category "transport" with amount 50.00

  Scenario: Uncategorised transactions collapse into a single slice
    Given the following transactions in "2026-01":
      | type    | category | amount | pending |
      | expense |          | 10.00  | no      |
      | expense |          | 5.00   | no      |
    When I compute the expense category breakdown for "2026-01"
    Then the breakdown should have 1 slice
    And slice 1 should be uncategorised with amount 15.00

  Scenario: Pending expenses are excluded from the breakdown
    Given the following transactions in "2026-01":
      | type    | category  | amount | pending |
      | expense | groceries | 30.00  | no      |
      | expense | groceries | 100.00 | yes     |
    When I compute the expense category breakdown for "2026-01"
    Then the breakdown should have 1 slice
    And slice 1 should be category "groceries" with amount 30.00

  Scenario: Transfers never appear in an expense or income breakdown
    Given the following transactions in "2026-01":
      | type     | category  | amount | pending |
      | expense  | groceries | 20.00  | no      |
      | transfer |           | 500.00 | no      |
      | income   | salary    | 40.00  | no      |
    When I compute the expense category breakdown for "2026-01"
    Then the breakdown should have 1 slice
    When I compute the income category breakdown for "2026-01"
    Then the breakdown should have 1 slice
