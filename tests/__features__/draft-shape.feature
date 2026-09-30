Feature: Typing re-renders the composer, not the Assistant screen
  The screen keeps only the shape of the composer's text — typed or not, and
  the query while it is a "/" command — so a sentence costs the screen one
  re-render, not one per character (issue #27).

  Scenario: Typing a sentence changes the screen's state once
    When "lunch 12 at maxwell" is typed one character at a time
    Then the screen's state should change 1 time

  Scenario: Deleting it back to empty changes it once more
    When "lunch" is typed one character at a time and then deleted one at a time
    Then the screen's state should change 2 times

  Scenario: Whitespace alone is not typed
    Then the shape of "   " should be empty

  Scenario: A "/" query is followed character by character, then released
    When "/acc lunch" is typed one character at a time
    Then the slash query should have been "/", "/a", "/ac", "/acc" in turn
    And the final shape should be typed with no slash query
