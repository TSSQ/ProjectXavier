Feature: Transfer account resolution
  Deterministic, pure extraction of a transfer's destination ("to <account>")
  and source override ("from <account>") from the user's own text — the
  model's account field is never trusted for a transfer's target.

  Scenario: A simple "to <account>" names the destination
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "transfer 100 to Budget"
    Then the resolved "to" account should be "Budget"
    And the resolved "from" account should be none

  Scenario: "from X to Y" resolves both source and destination
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "transfer 100 from OCBC 360 to Budget"
    Then the resolved "to" account should be "Budget"
    And the resolved "from" account should be "OCBC 360"

  Scenario: No "to" keyword resolves to no destination
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "move 100 budget ocbc"
    Then the resolved "to" account should be none
    And the resolved "from" account should be none

  Scenario: Matching is case-insensitive
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "transfer to ocbc 360"
    Then the resolved "to" account should be "OCBC 360"

  Scenario: A multi-word account name is matched
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "send $50 to OCBC 360"
    Then the resolved "to" account should be "OCBC 360"

  Scenario: A word-boundary mismatch means only the longer name matches at all
    Given active accounts "Invest", "Investments"
    When I resolve transfer accounts in "transfer 100 to Investments"
    Then the resolved "to" account should be "Investments"

  Scenario: The shorter account name still matches on its own
    Given active accounts "Invest", "Investments"
    When I resolve transfer accounts in "transfer 100 to Invest"
    Then the resolved "to" account should be "Invest"

  Scenario: When both a name and a longer name containing it match, the longer one wins
    Given active accounts "Invest", "Invest Co"
    When I resolve transfer accounts in "transfer 100 to Invest Co"
    Then the resolved "to" account should be "Invest Co"

  Scenario: Trailing punctuation doesn't break the match
    Given active accounts "OCBC 360", "Budget"
    When I resolve transfer accounts in "transfer $100 to Budget."
    Then the resolved "to" account should be "Budget"

  Scenario: A regex-metacharacter account name still matches literally
    Given active accounts "Savings (USD)", "Budget"
    When I resolve transfer accounts in "transfer 100 to Savings (USD)"
    Then the resolved "to" account should be "Savings (USD)"
