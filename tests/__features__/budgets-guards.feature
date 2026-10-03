Feature: Stale budget cards, orphaned categories, labels and the small pure helpers
  Pure rules the budget surfaces lean on (spec sections 6 and 8).

  Scenario: A card is stale once the data revision moves on
    Then a card built at revision 7 should be fresh at 7 and stale at 8

  Scenario Outline: A set-budget confirm re-checks the category and the currency
    Given the categories Groceries and Dining
    When I confirm a "<built>" budget for "<category>" while the currency is "<now>"
    Then the check should be "<result>"

    Examples:
      | built | category  | now | result           |
      | SGD   | groceries | SGD | ok               |
      | SGD   | gone      | SGD | category-gone    |
      | SGD   | groceries | JPY | currency-changed |

  Scenario: A category that became a child no longer takes a budget
    Given the categories Groceries and Dining
    And Groceries is now a child of Dining
    When I confirm a "SGD" budget for "groceries" while the currency is "SGD"
    Then the check should be "category-gone"

  Scenario: A child whose parent was deleted counts as top-level
    Given an orphaned expense category with 30 spent in October
    When I compute October with no budget for it
    Then the orphan should appear under Not budgeted at 30
    When I compute October with a budget of 100 for it
    Then the orphan should have 70 left

  Scenario: Month labels carry the year only when it is not the current one
    Then the label for "2026-10" in 2026 should be "October" and short "Oct"
    And the label for "2027-10" in 2026 should be "October 2027" and short "Oct 2027"

  Scenario: The warn colour is a named token with the mockup's hexes
    Then the dark warn token should be "#E0B84B" and the light one "#8A6D1F"
    And the warn chip background and the ok and over backgrounds match the mockup's

  Scenario: A purchase that exactly fills what is left is not capped
    Then a ghost of 40 against 100 with 60 spent should not be capped
    And a ghost of 41 against 100 with 60 spent should be capped and clamped
