Feature: Pending transactions are excluded from money math
  A pending transaction stays visible in lists (marked) but must contribute
  zero to every total, balance, and count until it's un-pended — at which
  point it re-enters automatically.

  Scenario: A pending expense is excluded from the period total
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 10.00  | 2026-01-05 | no      |
      | expense | 20.00  | 2026-01-10 | yes     |
      | income  | 50.00  | 2026-01-12 | yes     |
    When I view totals for "month" of "2026-01"
    Then the expense total should be 10.00
    And the income total should be 0.00

  Scenario: A pending transaction contributes nothing to an account balance
    Given an asset account "Checking" with opening balance 100.00
    And a pending expense of 30.00 from "Checking"
    Then the balance of "Checking" should be 100.00

  Scenario: A pending transfer moves nothing between accounts
    Given an asset account "Checking" with opening balance 100.00
    And an asset account "Savings" with opening balance 0.00
    And a pending transfer of 40.00 from "Checking" to "Savings"
    Then the balance of "Checking" should be 100.00
    And the balance of "Savings" should be 0.00

  Scenario: Un-pending a transaction makes it re-enter the balance
    Given an asset account "Checking" with opening balance 0.00
    And a pending expense of 15.00 from "Checking"
    When the transaction is marked not pending
    Then the balance of "Checking" should be -15.00

  Scenario: A pending expense is excluded from monthly period buckets
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 10.00  | 2026-01-05 | no      |
      | expense | 20.00  | 2026-01-10 | yes     |
    When I group transactions by "month"
    Then the "2026-01" bucket expense total should be 10.00

  Scenario: A period containing only a pending transaction does not appear in activePeriods
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 20.00  | 2026-02-10 | yes     |
    When I list active periods by "month"
    Then there should be 0 active periods

  Scenario: A pending expense is excluded from cash-flow buckets
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 10.00  | 2026-01-05 | no      |
      | expense | 20.00  | 2026-01-05 | yes     |
    When I compute the cash flow series for "2026-01" by "day"
    Then the "2026-01-05" cash-flow expense should be 10.00

  Scenario: Un-pending a transaction makes it re-enter the period total
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 20.00  | 2026-01-05 | yes     |
    When the first transaction is marked not pending
    And I view totals for "month" of "2026-01"
    Then the expense total should be 20.00

  Scenario: Un-pending a transaction makes it re-enter monthly period buckets
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 20.00  | 2026-01-05 | yes     |
    When the first transaction is marked not pending
    And I group transactions by "month"
    Then the "2026-01" bucket expense total should be 20.00

  Scenario: Un-pending a transaction makes it re-enter cash-flow buckets
    Given the following transactions:
      | type    | amount | date       | pending |
      | expense | 20.00  | 2026-01-05 | yes     |
    When the first transaction is marked not pending
    And I compute the cash flow series for "2026-01" by "day"
    Then the "2026-01-05" cash-flow expense should be 20.00
