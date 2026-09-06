Feature: Once-per-token deep-link guard
  glass-chrome-adoption-spec D3.2: the "Add manually" chip sends
  /transactions?add=<token>; the Transactions screen must open the Add sheet
  exactly once per token, never again on tab-away-and-back (expo-router keeps
  the tab's params), and again for a fresh token.

  Scenario: A new token is handled once and remembered
    Given no token has been handled
    When the screen sees token "1725600000000"
    Then the link should be handled
    And the remembered token should be "1725600000000"

  Scenario: The same token seen again is ignored
    Given the last handled token is "1725600000000"
    When the screen sees token "1725600000000"
    Then the link should not be handled
    And the remembered token should be "1725600000000"

  Scenario: A fresh token after a stale one is handled
    Given the last handled token is "1725600000000"
    When the screen sees token "1725600004242"
    Then the link should be handled
    And the remembered token should be "1725600004242"

  Scenario: No token keeps the memory intact
    Given the last handled token is "1725600000000"
    When the screen sees no token
    Then the link should not be handled
    And the remembered token should be "1725600000000"
