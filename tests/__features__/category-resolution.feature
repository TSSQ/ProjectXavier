Feature: Category resolution
  Categories are matched case-insensitively and scoped to the transaction kind
  (an expense draft never matches an income category), with near-duplicates
  flagged so the user can merge them ("did you mean…?").

  Scenario: An exact name matches an existing category of the same kind, ignoring case and spacing
    Given existing categories:
      | name     | kind    |
      | Travel   | expense |
      | Salary   | income  |
    When I resolve the expense category "  travel "
    Then it should match the existing category "Travel"

  Scenario: A close typo is offered as a merge suggestion
    Given existing categories:
      | name   | kind    |
      | Travel | expense |
    When I resolve the expense category "Trvael"
    Then it should suggest the existing category "Travel"

  Scenario: A clearly different name is treated as new
    Given existing categories:
      | name   | kind    |
      | Travel | expense |
    When I resolve the expense category "Zzyzx Frobnication"
    Then it should be treated as a new category

  Scenario: A name that exists only under a different kind is treated as new
    Given existing categories:
      | name   | kind   |
      | Travel | income |
    When I resolve the expense category "Travel"
    Then it should be treated as a new category

  Scenario: An empty name is treated as new
    Given existing categories:
      | name   | kind    |
      | Travel | expense |
    When I resolve the expense category "   "
    Then it should be treated as a new category

  Scenario: An exact match takes precedence over a fuzzy candidate
    Given existing categories:
      | name    | kind    |
      | Travel  | expense |
      | Trravel | expense |
    When I resolve the expense category "Travel"
    Then it should match the existing category "Travel"
