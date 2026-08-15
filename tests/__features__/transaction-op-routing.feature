Feature: Chat transaction delete/update routing — no new write path
  docs/design/chat-transaction-delete-update-spec.md §7 acceptance #11/#12 —
  the chat screen reuses the EXISTING deleteTransaction/updateTransaction
  primitives and TransactionFormSheet; it must never grow a second, bespoke
  write path, and it must never import the (unrelated) account-delete
  cascade primitive either. Modelled on account-delete-routing.feature.

  §13 amendment (multi-select delete) deliberately adds a SECOND primitive,
  `deleteTransactions(ids)` (src/features/transactions/repository.ts) — one
  atomic batch DELETE for the multi-select flow, not a bespoke write path.
  The invariant becomes "exactly one call site PER write primitive": both
  `deleteTransaction(` (the single-pick path) and `deleteTransactions(` (the
  batch path) are asserted separately, so a regression that starts looping
  `deleteTransaction(` for multi-delete (breaking the batch's atomicity) or
  that adds any other ad hoc write path is caught immediately.

  Scenario: The assistant screen contains exactly one deleteTransaction( call site
    Then the assistant screen source should contain exactly 1 occurrence of "deleteTransaction("

  Scenario: The assistant screen contains exactly one deleteTransactions( batch call site
    Then the assistant screen source should contain exactly 1 occurrence of "deleteTransactions("

  Scenario: The assistant screen still never imports or calls deleteAccountCascade
    Then the assistant screen source should not reference "deleteAccountCascade"

  Scenario: The assistant screen reuses the existing transaction repository primitives and form sheet
    Then the assistant screen source should reference "updateTransaction"
    And the assistant screen source should reference "TransactionFormSheet"
