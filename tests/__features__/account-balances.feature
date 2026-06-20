Feature: Account balances
  Balances must reflect every transaction so the user can trust the numbers.

  Scenario: An expense reduces an asset account balance
    Given an asset account "Checking" with opening balance 100.00
    When I record an expense of 30.00 from "Checking"
    Then the balance of "Checking" should be 70.00

  Scenario: Income increases an asset account balance
    Given an asset account "Checking" with opening balance 100.00
    When I record income of 50.00 into "Checking"
    Then the balance of "Checking" should be 150.00

  Scenario: A transfer moves money between accounts
    Given an asset account "Checking" with opening balance 100.00
    And an asset account "Savings" with opening balance 0.00
    When I transfer 40.00 from "Checking" to "Savings"
    Then the balance of "Checking" should be 60.00
    And the balance of "Savings" should be 40.00

  Scenario: Spending on a credit card increases the amount owed
    Given a liability account "Credit Card" with opening balance 0.00
    When I record an expense of 25.00 from "Credit Card"
    Then the balance of "Credit Card" should be -25.00
