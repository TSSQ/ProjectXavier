Feature: Database migration
  migrate()'s algorithm (src/db/migrationPlan.ts) must produce a working
  `pending` column on both a fresh install (CREATE TABLE) and an upgrade of an
  existing database (ALTER TABLE ADD COLUMN), and running it twice must never
  fail or duplicate a column. Driven against a real SQLite engine (node:sqlite)
  so the DDL text itself — not just the decision logic — is proven correct.

  Scenario: A fresh database gets a working pending column via CREATE TABLE
    Given a brand-new, empty database
    When I run the migration
    Then the transactions table should have a "pending" column
    And the "pending" column should be NOT NULL with default 0

  Scenario: An existing pre-pending database gets the column via ALTER TABLE
    Given a database with the pre-pending transactions schema
    And a transaction row already saved in that database
    When I run the migration
    Then the transactions table should have a "pending" column
    And the "pending" column should be NOT NULL with default 0
    And the existing transaction row should default "pending" to 0

  Scenario: Running the migration twice does not fail or duplicate the column
    Given a database with the pre-pending transactions schema
    When I run the migration
    And I run the migration again
    Then the migration should not have thrown
    And the transactions table should have exactly one "pending" column
