Feature: Net worth
  Net worth is the signed sum of ending balances across all non-archived
  accounts. Accounts are not typed as assets/liabilities — a balance you owe on
  (e.g. a credit card) is simply negative and subtracts itself. An account's
  optional tag is cosmetic and never affects the total.

  Scenario: Net worth is the signed sum of all balances
    Given an account "Checking" with opening balance 1000.00
    And an account "Credit Card" with opening balance -200.00
    Then the net worth should be 800.00

  Scenario: A cosmetic tag does not change net worth
    Given an account "Checking" tagged "asset" with opening balance 1000.00
    And an account "Credit Card" tagged "liability" with opening balance -200.00
    Then the net worth should be 800.00

  Scenario: Archived accounts are excluded from net worth
    Given an account "Checking" with opening balance 1000.00
    And an archived account "Old Wallet" with opening balance 500.00
    Then the net worth should be 1000.00

  Scenario: A transfer between accounts leaves net worth unchanged
    Given an account "Checking" with opening balance 1000.00
    And an account "Savings" with opening balance 0.00
    When I transfer 250.00 from "Checking" to "Savings"
    Then the net worth should be 1000.00
