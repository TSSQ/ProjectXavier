Feature: Self-transfer guard (review F2)
  Copying an incoming transfer must never forge a transfer whose source and
  destination are the same account. The invariant is enforced at every layer:
  the shared validation schema, the balance math (defence in depth for any
  bad row that predates the fix), and a one-time scan that finds existing
  offenders.

  Scenario: The schema rejects a transaction transfer with the same account on both sides
    Given a transaction transfer from "Checking" to "Checking" for 50.00
    Then the transaction schema should reject it with "A transfer can't use the same account on both sides"

  Scenario: The schema still accepts a normal transaction transfer between two accounts
    Given a transaction transfer from "Checking" to "Savings" for 50.00
    Then the transaction schema should accept it

  Scenario: The schema still accepts an ordinary expense
    Given a transaction expense from "Checking" for 12.50
    Then the transaction schema should accept it

  Scenario: The schema still accepts ordinary income
    Given a transaction income into "Checking" for 100.00
    Then the transaction schema should accept it

  Scenario: The recurring-template schema rejects a self-transfer template
    Given a recurring template transfer from "Checking" to "Checking" for 20.00
    Then the recurring template schema should reject it with "A transfer can't use the same account on both sides"

  Scenario: The recurring-template schema still accepts a normal transfer template
    Given a recurring template transfer from "Checking" to "Savings" for 20.00
    Then the recurring template schema should accept it

  Scenario: A self-transfer contributes nothing to its own account's balance
    Given a self-transfer of 75.00 within "Checking"
    Then the signed delta of that row for "Checking" should be 0

  Scenario: findSelfTransfers finds the bad row among good ones
    Given a normal transfer from "Checking" to "Savings" for 30.00
    And an expense from "Checking" for 5.00
    And a self-transfer of 40.00 within "Checking"
    Then findSelfTransfers should return exactly the self-transfer

  Scenario: findSelfTransfers finds nothing when every row is healthy
    Given a normal transfer from "Checking" to "Savings" for 30.00
    And an expense from "Checking" for 5.00
    Then findSelfTransfers should return no rows

  # ── Read/restore tolerance (review F2 QA Blocker) ──────────────────────────
  # The self-transfer refine is a WRITE-time invariant only — it must never
  # cause a READ of already-stored data (a `.sqlite`/`.json` restore) to throw.

  Scenario: The read-tolerant transaction schema accepts a legacy self-transfer row
    Given a stored transaction transfer from "Checking" to "Checking" for 60.00
    Then the read-tolerant transaction schema should accept it

  Scenario: The read-tolerant recurring-template schema accepts a legacy self-transfer template
    Given a stored recurring template transfer from "Checking" to "Checking" for 25.00
    Then the read-tolerant recurring template schema should accept it

  Scenario: findSelfTransferSeries finds the bad template among healthy ones
    Given an active series with a normal transfer template from "Checking" to "Savings"
    And an active series with an expense template from "Checking"
    And an active series with a self-transfer template within "Checking"
    Then findSelfTransferSeries should return exactly the self-transfer series

  Scenario: findSelfTransferSeries finds nothing when every series is healthy
    Given an active series with a normal transfer template from "Checking" to "Savings"
    And an active series with an expense template from "Checking"
    Then findSelfTransferSeries should return no series
