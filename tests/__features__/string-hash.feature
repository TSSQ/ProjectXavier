Feature: String hash and initial-letter helpers
  Pure helpers behind the payee list's derived avatar tile (no payee icon
  column — the tile is always computed from the name/category).

  Scenario: stringHash is deterministic for the same input
    Given the name "Joe's Cafe"
    When I hash it twice
    Then both hashes should be equal

  Scenario: stringHash is non-negative
    Given the name "Landlord"
    When I hash it
    Then the hash should be non-negative

  Scenario: stringHash differs for different names (no collision for this pair)
    Given the names "Alice" and "Bob"
    When I hash both
    Then the hashes should differ

  Scenario: initialOf uppercases an alphabetic first letter
    Given the name "landlord"
    When I take the initial
    Then the initial should be "L"

  Scenario: initialOf leaves a non-alphabetic first character as-is
    Given the name "7-Eleven"
    When I take the initial
    Then the initial should be "7"

  Scenario: initialOf leaves an emoji first character as-is
    Given the name "🚀 Rocket Fuel"
    When I take the initial
    Then the initial should be "🚀"

  Scenario: initialOf never returns an empty tile for a blank name
    Given the name "   "
    When I take the initial
    Then the initial should be "?"
