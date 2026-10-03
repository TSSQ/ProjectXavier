Feature: Setting, editing and removing budgets by chat
  Any natural wording for "set", "edit" or "remove" a category budget routes
  to a confirm card (monthly-budgets spec section 6.1, chat amendment). A
  deterministic router reads the common wordings; the on-device model is only
  a fallback, and code validates every slot it fills. Nothing is written
  without the user's Confirm.

  Scenario Outline: Set wordings route to set-budget
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should route to set-budget for "<category>" at <amount>

    Examples:
      | text                                | category  | amount |
      | set a budget of 300$ on food        | food      | 300    |
      | I want to spend max 450 on groceries| groceries | 450    |
      | cap food at 300 a month             | food      | 300    |
      | groceries 450 monthly budget        | groceries | 450    |
      | limit shopping to 200               | shopping  | 200    |
      | budget 300 for food                 | food      | 300    |
      | set groceries budget to 450         | groceries | 450    |
      | budget 200 for groceries            | groceries | 200    |
      | Could you please set my food budget to 300 dollars | food | 300 |
      | set a food budget of S$300          | food      | 300    |
      | set a budget for food of 300        | food      | 300    |
      | I need a budget of 120 for transport| transport | 120    |
      | max 450 on groceries a month        | groceries | 450    |

  Scenario Outline: Edit wordings route to edit-budget
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should route to edit-budget for "<category>" <how> <amount>

    Examples:
      | text                               | category  | how       | amount |
      | edit food budget to 200$           | food      | to        | 200    |
      | change food budget to 200          | food      | to        | 200    |
      | make my food budget 250            | food      | to        | 250    |
      | increase groceries budget to 500   | groceries | to        | 500    |
      | raise food budget by 50            | food      | raise by  | 50     |
      | lower shopping budget by 20        | shopping  | lower by  | 20     |
      | reduce my transport budget by 15   | transport | lower by  | 15     |
      | bump up food budget 25             | food      | raise by  | 25     |
      | can you cut down my shopping budget to 150 | shopping | to | 150 |
      | change the budget for food to 180  | food      | to        | 180    |

  Scenario Outline: Remove wordings route to remove-budget
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should route to remove-budget for "<category>"

    Examples:
      | text                         | category  |
      | remove food budget           | food      |
      | delete my shopping budget    | shopping  |
      | no budget for food           | food      |
      | clear the groceries budget   | groceries |
      | stop budgeting transport     | transport |
      | get rid of the food budget   | food      |
      | remove the budget for food   | food      |

  Scenario Outline: Spends and other talk are left alone
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should not route to a budget answer

    Examples:
      | text                               |
      | Budget Rent a Car 85               |
      | Lunch at Budget 12                 |
      | budget airline ticket 120          |
      | paid my budget app subscription 5  |
      | max 2 coffees 9                    |
      | limit hotel 200                    |
      | bought a cap 15                    |
      | no budget for gym                  |
      | cap 15 hat                         |
      | my budget is 500 a month           |
      | how is my food budget              |
      | what is my shopping budget         |
      | removed food budget app 5          |
      | delete my last transaction         |

  Scenario: An unknown category still routes, and then cannot be resolved
    Given the categories Food, Groceries, Shopping and Transport
    Then "set gym budget to 40" should route to set-budget for "gym" at 40
    And "remove gym budget" should route to remove-budget for "gym"
    And "gym" should resolve as none

  Scenario Outline: A command missing a slot asks, it never guesses
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should ask for the <missing>

    Examples:
      | text                 | missing  |
      | set food budget      | amount   |
      | set a budget of 300  | category |
      | set a budget         | category |
      | raise food budget    | amount   |
      | remove budget        | category |

  Scenario Outline: The reply to a clarifying question
    Then asking for the <missing> with "<category>" should read "<reply>"

    Examples:
      | missing  | category | reply                                                         |
      | category |          | Which category? Try: set food budget to 300                   |
      | amount   | Food     | How much should the Food budget be? Try: set food budget to 300 |
      | wording  |          | I didn't catch that budget. Try: set food budget to 300       |

  Scenario Outline: What the plan does for each action
    Given a Food budget of <current> this month
    When the user asks to <action>
    Then the plan should be <outcome> reading "<text>"

    Examples:
      | current | action          | outcome        | text                                                                          |
      | 300     | set 450         | confirm-set    | Change Food from $300 to $450, starting October?                              |
      | none    | set 450         | confirm-set    | Set a Food budget of $450, starting October?                                  |
      | 300     | edit to 200     | confirm-set    | Change Food from $300 to $200, starting October?                              |
      | none    | edit to 200     | confirm-set    | You don't have a Food budget yet. Set it to $200, starting October?           |
      | 300     | raise by 50     | confirm-set    | Raise Food by $50, from $300 to $350, starting October?                       |
      | 300     | lower by 20     | confirm-set    | Lower Food by $20, from $300 to $280, starting October?                       |
      | 300     | lower by 300    | reply          | Lowering Food by $300 would leave nothing (it is $300). To remove it, say "remove food budget". |
      | none    | raise by 50     | reply          | You don't have a Food budget yet. Try: set food budget to 300                 |
      | 300     | set 300         | reply          | Food is already $300 a month.                                                 |
      | 300     | remove          | confirm-remove | Remove Food budget ($300/month)?                                              |
      | none    | remove          | reply          | You don't have a Food budget.                                                 |

  Scenario: Confirming writes onward, and a removal is a tombstone
    Given a Food budget of 300 from September
    When the user confirms removing the Food budget in October
    Then Food has no budget in October and later
    And Food still has 300 in September
    And the removal row has a null amount

  Scenario: Confirming a raise writes the new amount onward
    Given a Food budget of 300 from September
    When the user confirms raising Food by 50 in October
    Then Food has 350 in October and later
    And Food still has 300 in September

  Scenario: Amounts are converted at the currency's exponent
    Then lowering by 500 in JPY from 3000 should plan 2500

  Scenario Outline: Wording the router does not read, but that is plainly about a budget
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should not be read by the router
    And "<text>" should be a candidate for the model

    Examples:
      | text                                              |
      | I'd like my food budget to be somewhere around 300 |
      | please change the budget I have for groceries to 400 |
      | food budget should be 300 from now on, set it     |
      | can you make my shopping budget a little lower, like 150 |

  Scenario Outline: Spends never reach the model
    Then "<text>" should not be a candidate for the model

    Examples:
      | text                               |
      | Budget Rent a Car 85               |
      | bought a cap 15                    |
      | max 2 coffees 9                    |
      | Lunch at Budget 12                 |
      | paid my budget app subscription 5  |
      | my budget is 500 a month           |
      | how is my food budget              |
      | coffee 4.50                        |

  Scenario: The model is asked with closed choices only
    Given the categories Food, Groceries, Shopping and Transport
    Then the model schema for "set my food budget to either 300 or 350" offers the categories and amounts 300, 350
    And the model schema for "set my food budget to 300" does not ask for an amount

  Scenario: Code validates every slot the model fills
    Given the categories Food, Groceries, Shopping and Transport
    Then a model answer of set Food for "make the food one 300" should read set-budget Food at 300
    And a model answer of set Dining for "make the dining one 300" should ask for the category
    And a model answer of set Food for "food budget please" should ask for the amount
    And a model answer of none for "can you tell me my budget" should be ignored
    And a model answer of remove Food for "get rid of the food limit" should read remove-budget Food
    And a model answer of edit Food lower for "food budget down by 20" should read edit-budget Food lowering by 20
    And a model answer of set Shopping for "set a budget of 300 please" should be checked with the user first
    And a model answer of set Food at an invented amount for "food budget is either 300 or 350" should ask for the amount

  Scenario: The model's schema is pinned to declaration order
    Given the categories Food, Groceries, Shopping and Transport
    Then the model schema for "set my food budget to either 300 or 350" has x-order action, category, direction, amount
