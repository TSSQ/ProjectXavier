Feature: Period account balances
  For a chosen period, each account's balance rolls forward: its start balance is
  the previous period's closing balance, and its closing balance adds that
  period's transactions. Net worth as of the period end is the sum of every
  account's closing balance.

  Scenario: Closing balance carries forward from the prior period
    Given an account "Checking" with opening balance 1000.00
    And the following transactions for "Checking":
      | type    | amount | date       |
      | expense | 100.00 | 2026-01-15 |
      | income  | 500.00 | 2026-02-10 |
      | expense | 50.00  | 2026-02-20 |
    When I view the month period of "2026-02"
    Then the start balance of "Checking" should be 900.00
    And the closing balance of "Checking" should be 1350.00
    And the period change of "Checking" should be 450.00

  Scenario: Net worth as of a period end sums all account closing balances
    Given an account "Checking" with opening balance 1000.00
    And an account "Card" with opening balance -200.00
    And the following transactions for "Checking":
      | type   | amount | date       |
      | income | 500.00 | 2026-02-10 |
    And the following transactions for "Card":
      | type    | amount | date       |
      | expense | 50.00  | 2026-02-20 |
    When I view the month period of "2026-02"
    Then the net worth as of the period end should be 1250.00

  # ── periodBalancesOf (spec §5.4, criterion 9) ───────────────────────────────
  # periodBalancesOf returns one row per account it's given — no internal
  # archived filter — with the exact same start/close/change arithmetic as
  # accountPeriodBalances, which now delegates to it after pre-filtering.
  Scenario: periodBalancesOf returns a row for an archived account too, with the same arithmetic
    Given an account "Checking" with opening balance 1000.00
    And an archived account "Old Wallet" with opening balance 500.00
    And the following transactions for "Old Wallet":
      | type    | amount | date       |
      | expense | 50.00  | 2026-02-05 |
    When I view the month period of "2026-02"
    Then periodBalancesOf on all accounts should return 2 rows
    And the periodBalancesOf start balance of "Old Wallet" should be 500.00
    And the periodBalancesOf closing balance of "Old Wallet" should be 450.00
