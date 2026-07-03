Feature: Icon sets for accounts and categories
  Curated emoji sets and accountIcon icon-preference behaviour.

  Scenario: ACCOUNT_ICONS is non-empty and duplicate-free
    Given the ACCOUNT_ICONS list
    Then it should be non-empty
    And it should contain no duplicates

  Scenario: CATEGORY_ICONS is non-empty and duplicate-free
    Given the CATEGORY_ICONS list
    Then it should be non-empty
    And it should contain no duplicates

  Scenario: accountIcon prefers a stored icon over the subtype default
    Given an account with subtype "bank" and icon "🚀"
    When I call accountIcon
    Then the emoji should be "🚀"
    And the bg should be "bg-chipTransfer"

  Scenario: accountIcon falls back to subtype emoji when icon is null
    Given an account with subtype "bank" and icon null
    When I call accountIcon
    Then the emoji should be "🏦"
    And the bg should be "bg-chipTransfer"

  Scenario: accountIcon falls back to default emoji for unknown subtype
    Given an account with subtype "unknown" and icon null
    When I call accountIcon
    Then the emoji should be "👛"
    And the bg should be "bg-chipTransfer"

  Scenario: A custom icon not in the set is prepended and stays selectable
    Given the category set and a custom value "🦄"
    When I compute the displayed icons
    Then "🦄" should be first in the displayed list
    And the displayed list should be one longer than the set

  Scenario: An icon already in the set is not duplicated
    Given the category set and a value already in the set
    When I compute the displayed icons
    Then the displayed list should equal the set

  Scenario: No value leaves the set unchanged
    Given the category set and an empty value
    When I compute the displayed icons
    Then the displayed list should equal the set

  Scenario: An over-long account icon is rejected by validation
    Given an account icon of 25 characters
    Then the account schema should reject it

  Scenario: A single-emoji account icon is accepted by validation
    Given an account icon "🦄"
    Then the account schema should accept it
