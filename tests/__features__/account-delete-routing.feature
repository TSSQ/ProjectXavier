Feature: Chat delete routing NEVER calls the cascade primitive
  docs/design/account-chat-crud-spec.md §5.3/§8 acceptance #5: chat delete is
  recognize + handoff ONLY — `deleteAccountCascade` (the hard-delete
  primitive) must be reachable from exactly one place, the manage-accounts
  screen's typed-name-confirm sheet, and NEVER from the chat surface. Asserted
  at the routing level: the chat screen's source never references the
  cascade at all, and the cascade is imported by exactly the one screen
  that's allowed to call it.

  Scenario: The chat assistant screen never imports or calls deleteAccountCascade
    Then the assistant screen source should not reference "deleteAccountCascade"

  Scenario: deleteAccountCascade is only ever imported by the manage-accounts screen
    Then only "app/manage-accounts.tsx" should import deleteAccountCascade from the accounts repository
