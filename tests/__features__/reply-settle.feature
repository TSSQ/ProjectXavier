Feature: Face self-settle rule
  composer-seated-with-xavier-spec.md section 12 E3, changed by the daily chat
  (docs/design/xavier-daily-chat-spec.md section 6.4): a transient outcome - the
  confused face after an error/clarify, the happy/angry face after a save -
  clears itself, but ONLY Xavier's face. Receipts and replies are messages in
  the day's feed and stay in the history; nothing resets to the greeting.

  Scenario: A save settles the face at 5s
    Given the last outcome is "saved"
    Then it should settle
    And it should settle after 5000ms

  Scenario: Spending money settles the same way as saving
    Given the last outcome is "spent"
    Then it should settle
    And it should settle after 5000ms

  Scenario: An error settles the face at 4s
    Given the last outcome is "error"
    Then it should settle
    And it should settle after 4000ms

  Scenario: A clarifying question settles the face at 4s
    Given the last outcome is "clarify"
    Then it should settle
    And it should settle after 4000ms

  Scenario: No outcome never settles
    Given the last outcome is "none"
    Then it should not settle

  Scenario: No outcome resets any reply text
    Then the rule carries no reply reset for any outcome
