Feature: Setting a budget by chat
  "set groceries budget to 450" and its siblings route to a set-budget
  confirm; texts that merely contain "budget" still log as spends (spec
  section 6.1 and 6.3).

  Scenario Outline: Set-budget statements route
    Given the categories Groceries and Dining
    Then "<text>" should route to set-budget for "<category>" at <amount>

    Examples:
      | text                           | category  | amount |
      | set groceries budget to 450    | groceries | 450    |
      | groceries budget 450           | groceries | 450    |
      | budget 450 for groceries       | groceries | 450    |
      | set my dining budget 600       | dining    | 600    |
      | Dining budget = 600            | Dining    | 600    |
      | groceries budget is $1,200     | groceries | 1200   |

  Scenario: An explicit set-budget for an unknown category still routes
    Given the categories Groceries and Dining
    Then "set gym budget to 40" should route to set-budget for "gym" at 40

  Scenario Outline: Spends and other budget talk fall through
    Given the categories Groceries and Dining
    Then "<text>" should not route to a budget answer

    Examples:
      | text                               |
      | Budget Rent a Car 85               |
      | budget airline ticket 120          |
      | Budget Taxi 12                     |
      | paid my budget app subscription 5  |
      | my budget is 500 a month           |
      | my budget is 500                   |
      | budget 400 for groceries next month|
      | how is my groceries budget         |
      | Lunch at Budget 12                 |
      | Taxi budget 12                     |
      | Dinner budget 45                   |
      | Hotel budget 120                   |
      | coffee budget 4.50                 |
      | dinner with Budget 30              |
      | parked from Budget 8               |

  Scenario Outline: The category resolves exactly, by suggestion, or not at all
    Given the categories Groceries and Dining
    Then "<typed>" should resolve as <kind>

    Examples:
      | typed     | kind       |
      | groceries | exact      |
      | grocries  | suggestion |
      | gym       | none       |

  Scenario: The confirm copy
    Then changing Groceries from 400 to 450 should read "Change Groceries from $400 to $450, starting October?"
    And setting a first Groceries budget of 450 should read "Set a Groceries budget of $450, starting October?"
    And a missing category should read "I couldn't find a Dining category."
