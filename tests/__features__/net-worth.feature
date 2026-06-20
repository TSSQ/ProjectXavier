Feature: Net worth
  Net worth is total assets plus liabilities (liabilities are negative).

  Scenario: Net worth combines assets and liabilities
    Given an asset account "Checking" with opening balance 1000.00
    And a liability account "Credit Card" with opening balance -200.00
    Then the total assets should be 1000.00
    And the total liabilities should be -200.00
    And the net worth should be 800.00

  Scenario: Archived accounts are excluded from net worth
    Given an asset account "Checking" with opening balance 1000.00
    And an archived asset account "Old Wallet" with opening balance 500.00
    Then the net worth should be 1000.00
