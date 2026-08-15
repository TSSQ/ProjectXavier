Feature: Multi-select delete — selected-set summary (pure, DB-free)
  docs/design/chat-transaction-delete-update-spec.md §13 amendment — user-
  driven multi-select delete (the user ticks rows the deterministic picker
  already resolved; DELETE ONLY, never update). Before committing, the
  confirm must show the blast radius: how many rows, their total amount, and
  every transfer counterparty by name (deleting a transfer changes a SECOND
  account's balance — spec §9.1). `summarizeTransactionSelection` computes
  all of this as pure, synchronous data, with no database involved.

  Scenario: An empty selection summarises to zero, with nothing to disclose
    When I summarise an empty selection
    Then the selection count should be 0
    And the selection total should be 0 minor units
    And the selection should disclose no transfer counterparties

  Scenario: The total is the sum of each row's positive amount, not a signed net
    Given a selection of an expense of 1000, an income of 500, and a transfer of 2000
    When I summarise the selection
    Then the selection count should be 3
    And the selection total should be 3500 minor units

  Scenario: A selection with no transfers discloses no counterparties
    Given a selection of an expense of 1000 and an income of 500
    When I summarise the selection
    Then the selection should disclose no transfer counterparties

  Scenario: A selection with one transfer names its counterparty account
    Given a selection containing a transfer from "Wallet" to "Savings"
    When I summarise the selection
    Then the selection should disclose the transfer counterparties "Savings"

  Scenario: A selection with transfers to two different accounts names both, sorted
    Given a selection containing a transfer from "Wallet" to "Savings" and a transfer from "Wallet" to "Investment"
    When I summarise the selection
    Then the selection should disclose the transfer counterparties "Investment, Savings"

  Scenario: Two transfers to the SAME counterparty account are deduplicated to one name
    Given a selection containing two transfers from "Wallet" to "Savings"
    When I summarise the selection
    Then the selection should disclose the transfer counterparties "Savings"

  Scenario: A transfer's counterparty id that no longer resolves to a real account falls back to a generic name
    Given a selection containing a transfer to an account id that no longer exists
    When I summarise the selection
    Then the selection should disclose the transfer counterparties "the other account"

  Scenario: The summary is deterministic — identical input, identical output across 50 iterations
    Given a selection containing a transfer from "Wallet" to "Savings" and a transfer from "Wallet" to "Investment"
    When I summarise the same selection 50 times
    Then every one of the 50 summaries should be identical
