Feature: Input safety
  Free text is stored via bound parameters, and AI output is validated.

  Scenario: A note containing SQL is stored verbatim and safely
    Given a transaction whose note is "Lunch'); DROP TABLE transactions;--"
    When I save it through the parameterised repository
    Then the stored note should equal "Lunch'); DROP TABLE transactions;--"
    And the SQL statement should use bound parameters, not the note text

  Scenario: AI output missing the amount is rejected
    Given an AI returns a parsed expense with no amount
    Then validation should flag "amount" as a missing field

  Scenario: Malformed AI output fails schema validation
    Given an AI returns a parsed expense with a negative amount
    Then schema validation should reject it
