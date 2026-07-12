Feature: sourceText is capped before it reaches the transaction schema
  A long receipt scan or utterance must never make a confirmed draft
  permanently unsaveable (assessment H2). buildTransaction truncates
  sourceText to the schema's limit before persistence.

  Scenario: A 5000-character sourceText is truncated and still validates
    Given a confirmed draft with a 5000-character sourceText
    When the draft is built into a transaction
    Then the transaction sourceText should be exactly SOURCE_TEXT_MAX_CHARS long
    And the transaction should pass transactionSchema validation

  Scenario: A short sourceText is left unchanged
    Given a confirmed draft with the sourceText "Coffee at Blue Bottle"
    When the draft is built into a transaction
    Then the transaction sourceText should equal "Coffee at Blue Bottle"

  Scenario: A null sourceText stays null
    Given a confirmed draft with no sourceText
    When the draft is built into a transaction
    Then the transaction sourceText should be null

  Scenario: An undefined sourceText stays null
    Given a confirmed draft whose sourceText is undefined
    When the draft is built into a transaction
    Then the transaction sourceText should be null

  Scenario: A sourceText of exactly the cap length is unchanged
    Given a confirmed draft with a sourceText exactly SOURCE_TEXT_MAX_CHARS long
    When the draft is built into a transaction
    Then the transaction sourceText should be exactly SOURCE_TEXT_MAX_CHARS long
    And the transaction should pass transactionSchema validation

  Scenario: Truncation is surrogate-safe when an astral char straddles the cut
    Given a confirmed draft whose sourceText has an emoji straddling the cut point
    When the draft is built into a transaction
    Then the transaction sourceText should contain no unpaired surrogate
    And the transaction sourceText length should be at most SOURCE_TEXT_MAX_CHARS
    And the transaction should pass transactionSchema validation

  Scenario: An empty-string sourceText is preserved, not turned into null
    Given a confirmed draft with the sourceText ""
    When the draft is built into a transaction
    Then the transaction sourceText should equal ""
