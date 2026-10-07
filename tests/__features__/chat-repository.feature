Feature: The chat repository against a real SQLite engine
  The repository's own functions run here with only the expo driver stubbed by
  node:sqlite, so ordering, the backup gate and the restore clear are tested
  for real (docs/design/xavier-daily-chat-spec.md sections 5 and 6.1).

  Scenario: Twenty concurrent appends get unique sequence numbers
    Given an empty chat table
    When 20 messages are appended at once
    Then the sequence numbers should run 1 to 20 with no duplicates

  Scenario: A malformed stored row is skipped and logged without content
    Given an empty chat table
    And a good message and a malformed row holding a secret
    When the day is listed
    Then only the good message should come back
    And the log lines should not contain the secret

  Scenario: The reset check is one exclusive section
    Given a chat table holding yesterday's messages
    And the backup gate is held by a running backup
    When an unlocked cold-launch check starts
    Then nothing should be cleared while the gate is held
    When the backup finishes
    Then the chat should be cleared and the notice armed

  Scenario: An append waits for the reset check instead of slipping into it
    Given a chat table holding yesterday's messages
    When a cold-launch check and an append of today's first message run together
    Then yesterday's messages are gone and today's message survives with seq 1

  Scenario: A restore clears the chat inside its transaction
    Given a chat table holding yesterday's messages
    When a backup is applied
    Then the chat table should have been cleared inside the restore transaction

  Scenario: A card's content and status can be rewritten, and an invalid rewrite is refused
    Given an empty chat table
    When a draft card is appended, edited, and resolved
    Then the stored draft should show the edit and be resolved
    And a rewrite with an invalid amount should be refused and leave the row alone
