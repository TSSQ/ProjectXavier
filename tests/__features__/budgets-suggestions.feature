Feature: First-run suggestions from the last three months
  The 3-month average of counted spend, rounded to the nearest 10 (half up),
  seeds the first-run checklist; averages of 50 or more start ticked (spec
  section 4.5).

  Scenario: The average rounds to the nearest ten, half up
    Given Dining spend of these amounts in July, August and September:
      | july | august | september |
      | 400  | 500    | 750       |
    When I ask for suggestions for October
    Then Dining should be suggested at 550

  Scenario Outline: Rounding at the edges
    Given Dining spend totalling <total> over the three months before October
    When I ask for suggestions for October
    Then Dining should be suggested at <suggested>

    Examples:
      | total | suggested |
      | 135   | 50        |
      | 150   | 50        |
      | 165   | 60        |
      | 60    | 20        |

  Scenario: Averages of 50 or more start ticked and the rest start unticked
    Given Dining spend totalling 600 over the three months before October
    And Gifts spend totalling 120 over the three months before October
    When I ask for suggestions for October
    Then Dining should be suggested at 200 and ticked
    And Gifts should be suggested at 40 and unticked
    And Dining should be listed before Gifts

  Scenario: No spend in the three months means no suggestions
    Given no spend in the three months before October
    When I ask for suggestions for October
    Then there should be no suggestions

  Scenario: Only counted spend and full calendar months are averaged
    Given Dining spend of 300 in October itself and 30 pending in September
    When I ask for suggestions for October
    Then there should be no suggestions
