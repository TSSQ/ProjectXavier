Feature: Shared archived-account scope (Dashboard + Transactions tab)
  The session-scoped "Include archived" toggle (docs/design/
  account-archive-restore-spec.md §5.3/§5.3a) governs the Dashboard and the
  Transactions tab through the SAME pure helpers, so archiving means one
  thing everywhere instead of each screen re-implementing its own filter.

  # ── accountsInScope ──────────────────────────────────────────────────────
  Scenario: With the toggle off, only active accounts are in scope
    Given an account "Checking"
    And an archived account "Old Wallet"
    When I compute accounts in scope with includeArchived false
    Then the in-scope names should be "Checking"

  Scenario: With the toggle on, every account is in scope, preserving order
    Given an account "Checking"
    And an archived account "Old Wallet"
    And an account "Savings"
    When I compute accounts in scope with includeArchived true
    Then the in-scope names should be "Checking, Old Wallet, Savings"

  Scenario: With no archived accounts, the toggle changes nothing
    Given an account "Checking"
    And an account "Savings"
    When I compute accounts in scope with includeArchived false
    Then the in-scope names should be "Checking, Savings"

  # ── isTransactionVisible (the Transactions tab's ledger filter, §5.3a) ─────
  Scenario: A transaction is visible when its account is in the visible set
    Given the visible account ids "checking"
    And an expense transaction on account "checking"
    Then the transaction should be visible

  Scenario: A transaction is hidden when its account is not in the visible set
    Given the visible account ids "checking"
    And an expense transaction on account "old-wallet"
    Then the transaction should not be visible

  Scenario: A transfer stays visible from its "from" leg even when the "to" leg is archived (§8.2)
    Given the visible account ids "checking"
    And a transfer transaction from account "checking" to account "old-wallet"
    Then the transaction should be visible

  Scenario: A transfer stays visible from its "to" leg even when the "from" leg is archived (§8.2)
    Given the visible account ids "checking"
    And a transfer transaction from account "old-wallet" to account "checking"
    Then the transaction should be visible

  Scenario: A transfer is hidden when neither leg is in the visible set
    Given the visible account ids "checking"
    And a transfer transaction from account "wallet-a" to account "wallet-b"
    Then the transaction should not be visible

  Scenario: A transfer between two archived legs becomes visible once both are in scope
    Given the visible account ids "wallet-a,wallet-b"
    And a transfer transaction from account "wallet-a" to account "wallet-b"
    Then the transaction should be visible
