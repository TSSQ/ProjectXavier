Feature: Budget persistence paths write what they promise
  The category delete path removes the category's budget rows in the same
  transaction, and restore re-inserts every budget column (spec section 3).
  Both are exercised against recording fakes of the native database.

  Scenario: Deleting a category deletes its budget rows inside the transaction
    Given a database with budgets for Dining and Groceries
    When I delete the Dining category through the repository
    Then the category row should be deleted inside a transaction
    And only Groceries should still have budget rows

  Scenario: Restore writes every budget column
    Given a backup holding a one-off and an open-ended budget
    When I apply the backup
    Then each budget should be inserted with every column
    And the budgets should be cleared before they are inserted

  Scenario: Restore refuses a malformed budget row at the write boundary
    Given a backup holding a budget with an amount of 0
    When I apply the backup expecting a failure
    Then the restore should have been rejected
