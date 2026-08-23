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

  # ── row display amount vs balance contribution ───────────────────────────
  # The account screen passed `signedDelta` straight into the row as its
  # display amount, and signedDelta returns 0 for anything not counted — so a
  # future-dated transaction rendered as $0.00 while still showing its payee
  # and date. `signedAmountFor` is the same direction logic WITHOUT the
  # counting gate: what the row should show. Whether it counts is a separate
  # question, already answered on screen by the Upcoming/Pending chip.

  Scenario: A future-dated expense still displays its real amount
    Given today is "2026-08-23"
    And an expense of 21.19 on "Visa" dated "2026-09-25"
    Then its display amount for "Visa" should be -2119
    And its balance contribution for "Visa" should be 0

  Scenario: A pending expense still displays its real amount
    Given today is "2026-08-23"
    And a pending expense of 21.19 on "Visa" dated "2026-08-01"
    Then its display amount for "Visa" should be -2119
    And its balance contribution for "Visa" should be 0

  Scenario: A counted expense displays and contributes the same
    Given today is "2026-08-23"
    And an expense of 21.19 on "Visa" dated "2026-08-01"
    Then its display amount for "Visa" should be -2119
    And its balance contribution for "Visa" should be -2119

  # Direction still depends on which side you are viewing.
  Scenario: A future-dated transfer displays negative on the source
    Given today is "2026-08-23"
    And a transfer of 230.77 from "Budget" to "Visa" dated "2026-09-30"
    Then its display amount for "Budget" should be -23077

  Scenario: A future-dated transfer displays positive on the destination
    Given today is "2026-08-23"
    And a transfer of 230.77 from "Budget" to "Visa" dated "2026-09-30"
    Then its display amount for "Visa" should be 23077

  Scenario: A self-transfer displays nothing either way
    Given today is "2026-08-23"
    And a transfer of 50.00 from "Visa" to "Visa" dated "2026-08-01"
    Then its display amount for "Visa" should be 0
