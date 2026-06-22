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

  Scenario: Picking a known payee auto-fills its default category
    Given a payee "Joe's" whose default category is "cat-food"
    When I resolve the category with no explicit choice
    Then the resolved category should be "cat-food"

  Scenario: An explicit category overrides the payee default
    Given a payee "Joe's" whose default category is "cat-food"
    When I resolve the category with an explicit choice of "cat-coffee"
    Then the resolved category should be "cat-coffee"
