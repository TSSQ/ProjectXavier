Feature: Budget SQL is parameterised and the table migrates idempotently
  Every statement in the budgets repository is built with bound parameters
  (CLAUDE.md guardrail 4), runs against a real SQLite engine, and the budgets
  table is created idempotently by the migration plan.

  Scenario: Budget statements bind every value
    Given a category id and month that look like SQL
    When I build the budget statements
    Then no statement should contain the value text
    And every statement should use bound parameters

  Scenario: The budgets repository builds SQL only through the parameterised builders
    When I read the budgets repository source
    Then it should contain no template-literal or concatenated SQL

  Scenario: The migration creates budgets and is safe to run twice
    Given an empty database
    When I run the migrations twice
    Then the budgets table should exist with its index
    And the migrations should not have thrown

  Scenario: An onward write replaces later rows in a real database
    Given a database with an onward Dining budget from "2026-09" and a one-off for "2026-12"
    When I apply an onward write of 700 from "2026-11" through the SQL builders
    Then the stored budgets for Dining should resolve to 700 in December

  Scenario: Deleting a category removes its budget rows and no one else's
    Given a database with budgets for Dining and Groceries
    When I delete the Dining category's budgets through the SQL builders
    Then only Groceries should still have budget rows
