Feature: Payee resolution
  Payees are matched case-insensitively, near-duplicates are flagged so the user
  can merge them ("did you mean…?"), and picking a known payee auto-fills the
  category it was first used with.

  Scenario: An exact name matches an existing payee, ignoring case and spacing
    Given existing payees:
      | name      |
      | Starbucks |
      | Joe's     |
    When I resolve the payee "  starbucks "
    Then it should match the existing payee "Starbucks"

  Scenario: A close typo is offered as a merge suggestion
    Given existing payees:
      | name      |
      | Starbucks |
    When I resolve the payee "Starbux"
    Then it should suggest the existing payee "Starbucks"

  Scenario: A clearly different name is treated as new
    Given existing payees:
      | name      |
      | Starbucks |
    When I resolve the payee "Nonna's Trattoria"
    Then it should be treated as a new payee

  Scenario: A name plus noise words suggests the existing payee
    Given existing payees:
      | name     |
      | kopitiam |
    When I resolve the payee "the kopitiam"
    Then it should suggest the existing payee "kopitiam"

  Scenario: A name plus noise words beyond typo distance still suggests the existing payee
    Given existing payees:
      | name     |
      | kopitiam |
    When I resolve the payee "the old kopitiam"
    Then it should suggest the existing payee "kopitiam"

  Scenario: A bare name suggests the existing noise-worded payee
    Given existing payees:
      | name            |
      | the coffee shop |
    When I resolve the payee "coffee shop"
    Then it should suggest the existing payee "the coffee shop"

  Scenario: A short word contained in a longer name is not a variant
    Given existing payees:
      | name |
      | Shop |
    When I resolve the payee "the coffee shop"
    Then it should be treated as a new payee

  Scenario: A name embedded mid-word is not a variant
    Given existing payees:
      | name        |
      | Investments |
    When I resolve the payee "Invest"
    Then it should be treated as a new payee

  Scenario: Picking a known payee auto-fills its default category
    Given a payee "Joe's" whose default category is "cat-food"
    When I resolve the category with no explicit choice
    Then the resolved category should be "cat-food"

  Scenario: An explicit category overrides the payee default
    Given a payee "Joe's" whose default category is "cat-food"
    When I resolve the category with an explicit choice of "cat-coffee"
    Then the resolved category should be "cat-coffee"
