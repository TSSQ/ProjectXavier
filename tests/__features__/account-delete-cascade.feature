Feature: Account-delete cascade — one transaction, rollback-safe, forced pre-delete backup
  runAccountDeleteCascade (docs/design/account-chat-crud-spec.md §5.4) is
  driven against a REAL SQLite engine (node:sqlite), same convention as
  db/migrationPlan.ts's migration algorithm — proving the actual DDL/DML, not
  just the decision logic: deletes every transaction row referencing the
  account (as accountId OR transferAccountId), deletes the recurring series
  referencing it, deletes the account row, all inside one transaction that
  rolls back completely on any failure — and a forced backup always happens
  before any of it.

  Scenario: A successful cascade deletes exactly the right rows, in one transaction, after a forced backup
    Given a database with two accounts "DBS Savings" and "OCBC Current"
    And a $10 expense on "DBS Savings"
    And a $500 transfer from "DBS Savings" to "OCBC Current"
    And a $200 transfer from "OCBC Current" to "DBS Savings"
    And a recurring series referencing "DBS Savings"
    And an unrelated transaction on a third account "Cash Wallet"
    When I run the delete cascade for "DBS Savings"
    Then a pre-delete backup should have been taken before any row was deleted
    And every transaction referencing "DBS Savings" should be gone
    And the recurring series referencing "DBS Savings" should be gone
    And the "DBS Savings" account row should be gone
    And the unrelated transaction on "Cash Wallet" should still exist
    And "OCBC Current"'s own balance should no longer include the deleted transfers

  Scenario: A failure during the cascade rolls back every delete, but the backup still happened
    Given a database with two accounts "DBS Savings" and "OCBC Current"
    And a $10 expense on "DBS Savings"
    And a $500 transfer from "DBS Savings" to "OCBC Current"
    And the account-row delete is set to fail
    When I run the delete cascade for "DBS Savings" and it fails
    Then a pre-delete backup should have been taken
    And every transaction referencing "DBS Savings" should still exist
    And the "DBS Savings" account row should still exist

  Scenario: A failed backup aborts the whole cascade — zero rows change (QA MINOR follow-up)
    Given a database with two accounts "DBS Savings" and "OCBC Current"
    And a $10 expense on "DBS Savings"
    And the pre-delete backup is set to fail
    When I run the delete cascade for "DBS Savings" and it fails
    Then the cascade should have thrown
    And no delete of any kind should have been attempted
    And every transaction referencing "DBS Savings" should still exist
    And the "DBS Savings" account row should still exist

  Scenario: A recurring series created DURING the backup window is still deleted — no TOCTOU (QA MINOR follow-up)
    Given a database with two accounts "DBS Savings" and "OCBC Current"
    And a recurring series named "series-during-backup" referencing "DBS Savings" is inserted DURING the pre-delete backup
    When I run the delete cascade for "DBS Savings"
    Then the recurring series named "series-during-backup" should be gone too
