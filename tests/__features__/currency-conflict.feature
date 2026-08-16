Feature: Currency-conflict check (foreign-currency amounts corrupt balances)
  The app never converts currency (no FX, no rates, no network call —
  CLAUDE.md #3): `currencyConflict` is the pure decision behind "ask, never
  convert" — does a parsed/draft currency conflict with the destination
  account's own currency. `interpret()`/`interpretTransfer()`
  (domain/assistant.ts) are the only callers today; see their own feature
  (ai-assistant.feature) for the end-to-end behaviour this drives.

  Scenario: The same currency on both sides never conflicts
    Then "USD" against account currency "USD" should not conflict

  Scenario: A different currency conflicts
    Then "USD" against account currency "SGD" should conflict

  Scenario: The comparison is case-insensitive
    Then "usd" against account currency "USD" should not conflict
    And "usd" against account currency "sgd" should conflict

  Scenario: A missing draft currency never conflicts
    Then null against account currency "SGD" should not conflict
    And "" against account currency "SGD" should not conflict
    And "   " against account currency "SGD" should not conflict

  Scenario: An account with no currency never conflicts
    Then "USD" against account currency null should not conflict
    And "USD" against account currency "" should not conflict
