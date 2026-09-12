Feature: Account subtypes read as words, not as stored values

  The Dashboard showed "credit_card" under an account name in the 1.2 store
  screenshots. The label for that value already existed; three render sites
  just never used it. Because the subtype field is free text and gets
  snake_cased on the way in, the fix has to cover values nobody enumerated.

  Scenario: A known subtype uses its own label
    Given the stored subtype "credit_card"
    When I label it for display
    Then the label should be "Credit card"

  Scenario: Every known subtype has a label that is not the raw value
    Given every subtype the app offers as a choice
    When I label each one for display
    Then none of the labels should contain an underscore
    And none of the labels should equal its stored value

  Scenario: A subtype the user invented is humanised rather than shown raw
    Given the stored subtype "my_piggy_bank"
    When I label it for display
    Then the label should be "My piggy bank"

  Scenario: A user's own casing in later words is left alone
    Given the stored subtype "dbs_multiplier"
    When I label it for display
    Then the label should be "Dbs multiplier"

  Scenario: Repeated separators collapse to single spaces
    Given the stored subtype "joint__account"
    When I label it for display
    Then the label should be "Joint account"

  Scenario: A hyphenated subtype is humanised too
    Given the stored subtype "e-wallet"
    When I label it for display
    Then the label should be "E wallet"

  Scenario: The unknown sentinel renders nothing at all
    Given the stored subtype "unknown"
    When I label it for display
    Then there should be no label

  Scenario: A missing subtype renders nothing at all
    Given no stored subtype
    When I label it for display
    Then there should be no label

  Scenario: A blank subtype renders nothing at all
    Given the stored subtype "   "
    When I label it for display
    Then there should be no label

  Scenario: A known subtype typed in a different case still finds its label
    Given the stored subtype "Credit_Card"
    When I label it for display
    Then the label should be "Credit card"
