Feature: Composer visibility rules
  The seated composer (docs/design/composer-seated-with-xavier-spec.md) is
  either not there at all (a draft/account card owns the screen), a bare
  field ("+" and camera hidden), or the full "+" · field · camera/Send row —
  this pins every one of those states to the signals that already gate the
  chips and slash popover it replaces.

  Scenario: Idle — "+", field and camera, no Send
    Given the composer is idle with an empty field
    Then the composer should be visible
    And "+" should show
    And the camera should show
    And Send should not show

  Scenario: Typing — camera swaps for Send, "+" stays
    Given the composer is idle with the field "12 bucks lunch at Joe's"
    Then the composer should be visible
    And "+" should show
    And the camera should not show
    And Send should show

  Scenario: /account name step — field alone, no answer yet
    Given the /account Q&A is on the name step with an empty field
    Then the composer should be visible
    And "+" should not show
    And the camera should not show
    And Send should not show

  Scenario: /account subtype step — a typed answer still sends
    Given the /account Q&A is on the subtype step with the field "checking"
    Then the composer should be visible
    And "+" should not show
    And the camera should not show
    And Send should show

  Scenario: Draft pending — no composer at all
    Given a parsed draft card is pending
    Then the composer should not be visible
    And "+" should not show
    And the camera should not show
    And Send should not show

  Scenario: Account card pending — no composer at all
    Given an account confirm card is pending
    Then the composer should not be visible
    And "+" should not show
    And the camera should not show
    And Send should not show

  Scenario: An overlay (e.g. a query answer) hides "+" but keeps the field
    Given a query-answer overlay is up with the field "and last month?"
    Then the composer should be visible
    And "+" should not show
    And Send should show

  Scenario: Busy — "+" hides, Send stays for the in-flight submit
    Given the assistant is busy with the field "12 bucks lunch"
    Then the composer should be visible
    And "+" should not show
    And Send should show

  # Send clears the field the instant it is tapped, so the empty-field branch
  # would otherwise sit a camera glyph next to the parse spinner — and it
  # no-ops when tapped, because onScan guards on busy.
  Scenario: Busy with the field already cleared — no camera beside the spinner
    Given the assistant is busy with an empty field
    Then the composer should be visible
    And the camera should not show
    And Send should not show
