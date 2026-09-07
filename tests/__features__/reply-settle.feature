Feature: Reply self-settle rule
  composer-seated-with-xavier-spec.md §12 E3: a transient outcome — the
  confused face after an error/clarify, the happy/angry face after a save —
  used to sit on screen indefinitely. This pins which outcomes clear
  themselves, after how long, and whether the reply text resets to the
  greeting alongside the face — which also depends on whether a card flow
  owns the reply line at that moment.

  Scenario: A save settles at 5s and takes the reply with it
    Given the last outcome is "saved"
    Then it should settle
    And it should settle after 5000ms
    And it should reset the reply

  Scenario: Spending money settles the same way as saving
    Given the last outcome is "spent"
    Then it should settle
    And it should settle after 5000ms
    And it should reset the reply

  Scenario: An error settles at 4s but keeps its text
    Given the last outcome is "error"
    Then it should settle
    And it should settle after 4000ms
    And it should not reset the reply

  Scenario: A clarifying question settles at 4s but keeps its text
    Given the last outcome is "clarify"
    Then it should settle
    And it should settle after 4000ms
    And it should not reset the reply

  Scenario: No outcome never settles
    Given the last outcome is "none"
    Then it should not settle

  # The timer settles whatever the reply says when it fires, and mid-queue
  # that line is the queue's own progress ("2 of 6"), not the receipt. The
  # face still settles; dropping the greeting over a card the user is still
  # deciding on — inviting a tap on a "+" that isn't even mounted — does not.
  Scenario: A save while a card owns the screen settles the face but not the text
    Given the last outcome is "saved"
    And a card flow owns the screen
    Then it should settle
    And it should settle after 5000ms
    And it should not reset the reply

  Scenario: Spending while a card owns the screen keeps its text too
    Given the last outcome is "spent"
    And a card flow owns the screen
    Then it should settle
    And it should not reset the reply
