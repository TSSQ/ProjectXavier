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
      | food budget: 300                    | food      | 300    |
      | budget food 300 monthly             | food      | 300    |
      | budget for food 300                 | food      | 300    |
      | budget for food: 300                | food      | 300    |

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
      | bump up food budget by 25          | food      | raise by  | 25     |
      | lower food budget 200              | food      | to        | 200    |
      | bump food budget 400               | food      | to        | 400    |
      | drop shopping budget 20            | shopping  | to        | 20     |
      | drop shopping budget by 20         | shopping  | lower by  | 20     |
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
      | reset the food budget        | food      |
      | drop shopping budget         | shopping  |

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
      | budget 12 food                     |
      | budget lunch 12                    |
      | change food budget by 20           |

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
      | 300     | raise by 50     | confirm-set    | Raise Food's ongoing budget by $50, from $300 to $350, starting October?                       |
      | 300     | lower by 20     | confirm-set    | Lower Food's ongoing budget by $20, from $300 to $280, starting October?                       |
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
      | cut my transport budget to around 120 |
      | please change the budget I have for groceries to 400 |
      | food budget should be 300 from now on, set it     |

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

  Scenario: A delta builds on the ongoing amount, not on this month's one-off
    Given an ongoing Food budget of 300 and a one-off of 500 this month
    When the user asks to raise by 50
    Then the plan should be confirm-set reading "Raise Food's ongoing budget by $50, from $300 to $350 (October's one-off $500 is replaced), starting October?"

  Scenario: A delta with only a one-off to go on says so
    Given only a one-off Food budget of 500 this month
    When the user asks to lower by 50
    Then the plan should be reply reading "Food has only a one-off $500 for October, no ongoing budget. Try: set food budget to 300"

  Scenario: A raise of an ongoing budget replaces this month's one-off
    Given an ongoing Food budget of 300 and a one-off of 500 this month
    When the user confirms raising Food by 50 in October
    Then Food has 350 in October and later

  Scenario Outline: Spends that mention a budget are not budget commands
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should not route to a budget answer
    And "<text>" should not be a candidate for the model

    Examples:
      | text                                   |
      | need a budget phone 150                |
      | want budget headphones 40              |
      | Budget hotel 80 please                 |
      | Gym 50 a month up to 4 classes         |
      | Phone plan 30 a month up to 10GB       |
      | Netflix 15 per month, max 4 screens    |
      | update my budget app 5                 |
      | change budget app 5                    |
      | set food budget app 5                  |
      | clear shopping budget 20 refund        |
      | raise food budget 5 coffee             |
      | set groceries budget to 45 at costco   |
      | change dining budget 12 coffee         |

  Scenario: With a Lunch category, only the marked forms route
    Given the categories Food and Lunch
    Then "budget for lunch 12" should route to set-budget for "lunch" at 12
    And "budget lunch 12 monthly" should route to set-budget for "lunch" at 12
    And "budget lunch 12" should not route to a budget answer
    And "budget 12 food" should not route to a budget answer

  Scenario Outline: What chat cannot do is answered without asking the model
    Given the categories Food, Groceries, Shopping and Transport
    Then "<text>" should be answered with <reason> and the model is not asked

    Examples:
      | text                                         | reason          |
      | weekly food budget 100                       | monthly-only    |
      | set a daily food budget of 20                | monthly-only    |
      | please set a weekly food budget of 100       | monthly-only    |
      | set food budget to 300 for next month        | month-scope     |
      | set food budget to 300 this month only       | month-scope     |
      | set food budget to -50                       | positive-amount |
      | set a budget of 300 for food and transport   | single-category |
      | set food and transport budget to 300         | single-category |

  Scenario Outline: The model fallback decides what is shown
    Given the categories Food, Groceries, Shopping and Transport
    Then with <model> for "<text>" the Assistant shows <outcome>

    Examples:
      | model                    | text                                                    | outcome  |
      | no model                 | please change the budget I have for groceries to 400    | the hint |
      | no model                 | food budget should be 300 from now on, set it           | nothing  |
      | a none answer            | please change the budget I have for groceries to 400    | nothing  |
      | a failed answer          | please change the budget I have for groceries to 400    | nothing  |
      | a category question      | please change the budget I have for groceries to 400    | the question |
      | a category question      | food budget should be 300 from now on, set it           | nothing  |
      | an ungrounded pick       | food budget should be 300 from now on, set it           | nothing  |
      | an ungrounded pick       | please change the budget I have for groceries to 400    | the pick |
      | a set answer             | food budget should be 300 from now on, set it           | the set  |
      | no model                 | update my budget app 5                                  | nothing  |
      | a set answer             | update my budget app 5                                  | nothing  |

  Scenario Outline: The routing order keeps questions ahead of the model fallback
    Given the categories Food, Groceries, Shopping and Transport
    Then the gate for "<text>" should be <gate>

    Examples:
      | text                                                 | gate         |
      | list my budgets please                               | query        |
      | show me how much is left in my food budget please    | query        |
      | delete coffee 5 from food budget                     | none         |
      | can you show my food budget                          | none         |
      | I want to see my food budget                         | none         |
      | could you show spending vs budget this month         | none         |
      | weekly food budget 100                               | budget_model |
      | set food budget to 300 for next month                | budget_model |
      | lower food budget 200                                | edit_budget  |

  Scenario: The screen asks the model only after the other gates have returned
    Then in the Assistant screen the budget fallback comes after the transaction-op gate and before the parse ladder

  Scenario Outline: A set-budget for a missing category offers to create it
    Given the categories Food, Groceries, Shopping and Transport
    Then resolving "<text>" should <result>

    Examples:
      | text                          | result                                                                                                  |
      | set pets budget to 300        | offer to create Pets                                                                                    |
      | set a budget of 300 for pet supplies | offer to create Pet Supplies                                                                            |
      | set grocries budget to 300    | suggest Groceries with the create button for Grocries                                                   |
      | set food budget to 300        | go ahead with Food                                                                                      |
      | change gym budget to 100      | reply "You don't have a Gym category."                                                                  |
      | remove gym budget             | reply "You don't have a Gym category."                                                                  |
      | raise gym budget by 50        | reply "You don't have a Gym category."                                                                  |
      | change grocries budget to 100 | suggest Groceries without a create button                                                               |
      | remove grocries budget        | suggest Groceries without a create button                                                               |

  Scenario Outline: A category name has to be a real name
    Then the new category name for "<typed>" should be <name>

    Examples:
      | typed                                      | name        |
      | pets                                       | Pets        |
      | pet supplies                               | Pet Supplies |
      | today                                      | rejected    |
      | it                                         | rejected    |
      | tonight                                    | rejected    |
      | yesterday                                  | rejected    |
      | 123                                        | rejected    |
      | food and transport                         | rejected    |
      | a very long category name indeed           | rejected    |
      | x                                          | rejected    |

  Scenario: The create offer reads with the amount
    Then the create offer for Pets at 300 should read "You don't have a Pets category yet. Create it with a $300 monthly budget?"
    And the create done reply for Pets at 300 should read "Done. Created Pets with a $300 budget, starting October."

  Scenario: Confirming creates an expense category and writes the budget onward
    Given the categories Food, Groceries, Shopping and Transport
    Then creating Pets with 300 should make a top-level expense category and write 300 onward
    And creating food with 300 should reuse the existing Food and write 300 onward

  Scenario: Cancelling the offer writes nothing
    Given the categories Food, Groceries, Shopping and Transport
    When the user is offered to create Pets at 300
    And the user cancels
    Then no category was created and no budget was written
