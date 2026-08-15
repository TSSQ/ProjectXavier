Feature: Chat transaction delete/update routing — no new write path
  docs/design/chat-transaction-delete-update-spec.md §7 acceptance #11/#12 —
  the chat screen reuses the EXISTING deleteTransaction/updateTransaction
  primitives and TransactionFormSheet; it must never grow a second, bespoke
  write path, and it must never import the (unrelated) account-delete
  cascade primitive either. Modelled on account-delete-routing.feature.

  Scenario: The assistant screen contains exactly one deleteTransaction( call site
    Then the assistant screen source should contain exactly 1 occurrence of "deleteTransaction("

  Scenario: The assistant screen still never imports or calls deleteAccountCascade
    Then the assistant screen source should not reference "deleteAccountCascade"

  Scenario: The assistant screen reuses the existing transaction repository primitives and form sheet
    Then the assistant screen source should reference "updateTransaction"
    And the assistant screen source should reference "TransactionFormSheet"
