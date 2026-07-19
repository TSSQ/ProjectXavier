Feature: Single-currency relabel (review F1 / M7)
  The app stays single-currency, but changing the currency setting RELABELS
  every stored amount to the new code — it never converts. `rescaleMinor` is
  the pure exponent-shift math; `canChangeCurrencyFreely` gates whether
  Settings may apply the change without a warn+confirm modal;
  `relabelCurrencyWithStore` is the actual algorithm, exercised here against
  a fake in-memory store.

  # ─── rescaleMinor ───────────────────────────────────────────────────────

  Scenario: Same exponent is an identity (no rescale)
    Then rescaleMinor of 100050 from exponent 2 to exponent 2 should be 100050

  Scenario: Shrinking the exponent (SGD → JPY) preserves the displayed number
    Then rescaleMinor of 100000 from exponent 2 to exponent 0 should be 1000

  Scenario: Shrinking the exponent rounds a fractional remainder
    Then rescaleMinor of 100050 from exponent 2 to exponent 0 should be 1001

  Scenario: Growing the exponent (JPY → SGD) preserves the displayed number
    Then rescaleMinor of 1000 from exponent 0 to exponent 2 should be 100000

  Scenario: A 2-decimal to 3-decimal grow scales ×10
    Then rescaleMinor of 1234 from exponent 2 to exponent 3 should be 12340

  # ─── canChangeCurrencyFreely ────────────────────────────────────────────

  Scenario: An empty ledger (no accounts, no transactions) may change freely
    Then canChangeCurrencyFreely with 0 accounts and 0 transactions should be true

  Scenario: Any account blocks the free change
    Then canChangeCurrencyFreely with 1 accounts and 0 transactions should be false

  Scenario: Any transaction blocks the free change
    Then canChangeCurrencyFreely with 0 accounts and 1 transactions should be false

  Scenario: Both accounts and transactions present blocks the free change
    Then canChangeCurrencyFreely with 2 accounts and 5 transactions should be false

  # ─── relabelCurrencyWithStore (fake store) ──────────────────────────────

  Scenario: A same-exponent relabel preserves stored integers and rewrites codes
    Given the store's currency is "SGD"
    And an account with opening balance 500000 in "SGD"
    And a transaction with amount 1200 in "SGD"
    And a recurring template with amount 3000 in "SGD"
    When I relabel the currency to "USD"
    Then the account's currency should be "USD" and amount 500000
    And the transaction's currency should be "USD" and amount 1200
    And the recurring template's currency should be "USD" and amount 3000
    And the currency setting should be "USD"

  Scenario: A cross-exponent relabel rescales every stored amount
    Given the store's currency is "SGD"
    And an account with opening balance 500000 in "SGD"
    And a transaction with amount 100050 in "SGD"
    And a recurring template with amount 250000 in "SGD"
    When I relabel the currency to "JPY"
    Then the account's currency should be "JPY" and amount 5000
    And the transaction's currency should be "JPY" and amount 1001
    And the recurring template's currency should be "JPY" and amount 2500

  Scenario: The ledger is single-currency after a relabel
    Given the store's currency is "SGD"
    And an account with opening balance 100000 in "SGD"
    And a transaction with amount 500 in "SGD"
    When I relabel the currency to "JPY"
    Then every row's currency should be "JPY"

  Scenario: bumpDataRevision is called exactly once
    Given the store's currency is "SGD"
    And an account with opening balance 100000 in "SGD"
    When I relabel the currency to "USD"
    Then bumpDataRevision should have been called 1 time

  # ─── newCode validation (guardrail #6) ──────────────────────────────────

  Scenario: An unsupported currency code is rejected before touching the store
    Given the store's currency is "SGD"
    And an account with opening balance 100000 in "SGD"
    When I relabel the currency to "NOT-A-CODE"
    Then relabelling should have thrown
    And the account's currency should still be "SGD" and amount 100000
    And bumpDataRevision should have been called 0 times

  Scenario: An empty currency code is rejected
    Given the store's currency is "SGD"
    When I relabel the currency to ""
    Then relabelling should have thrown

  Scenario: A lowercase-but-valid currency code is normalized and accepted
    Given the store's currency is "SGD"
    And an account with opening balance 100000 in "SGD"
    When I relabel the currency to "jpy"
    Then the account's currency should be "JPY" and amount 1000

  # ─── Atomicity: a mid-transaction failure rolls every write back ────────
  # Proves the "all-or-nothing" comment on relabelCurrencyWithStore with a
  # store that actually buffers writes and discards them on rollback (rather
  # than just asserting the comment), by throwing partway through a batch of
  # row updates.

  Scenario: A successful relabel changes every row and the setting together
    Given a buffered store with currency "SGD"
    And a buffered account with opening balance 500000 in "SGD"
    And a buffered transaction with amount 100050 in "SGD"
    And a buffered recurring template with amount 250000 in "SGD"
    When I relabel the buffered store's currency to "JPY"
    Then the buffered account's currency should be "JPY" and amount 5000
    And the buffered transaction's currency should be "JPY" and amount 1001
    And the buffered recurring template's currency should be "JPY" and amount 2500
    And the buffered store's currency setting should be "JPY"
    And the buffered store's bumpDataRevision should have been called 1 time

  Scenario: A failure partway through the transaction rolls back every write
    Given a buffered store with currency "SGD"
    And a buffered account with opening balance 500000 in "SGD"
    And a buffered transaction with amount 100050 in "SGD"
    And a buffered recurring template with amount 250000 in "SGD"
    And the buffered store fails on row-update call 2
    When I relabel the buffered store's currency to "JPY"
    Then relabelling the buffered store should have thrown
    And the buffered account's currency should still be "SGD" and amount 500000
    And the buffered transaction's currency should still be "SGD" and amount 100050
    And the buffered recurring template's currency should still be "SGD" and amount 250000
    And the buffered store's currency setting should still be "SGD"
    And the buffered store's bumpDataRevision should have been called 0 times
