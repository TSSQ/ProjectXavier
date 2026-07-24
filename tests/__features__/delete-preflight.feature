Feature: Permanent-delete iCloud preflight
  checkDeletePreflight (QA MAJOR follow-up, docs/design/account-chat-crud-
  spec.md §5.4/§5.5) is UX ONLY — the hard invariant ("never delete without
  a completed forced backup") is enforced elsewhere (deleteAccountCascade
  itself aborts on a failed backup); this just decides whether the screen
  should offer an actionable message instead of opening a destructive sheet
  doomed to fail.

  Scenario: iCloud available — delete is allowed, no message
    Given iCloud is available
    When I check the delete preflight
    Then the delete should be allowed
    And there should be no preflight message

  Scenario: iCloud unavailable — delete is blocked with an actionable message
    Given iCloud is not available
    When I check the delete preflight
    Then the delete should be blocked
    And the preflight message should mention "iCloud"
