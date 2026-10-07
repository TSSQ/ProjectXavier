Feature: Xavier's speech bubble says what changed
  Every confirmation is one bubble from Xavier. A saved transaction carries its
  receipt, and an expense carries what is left in its budget
  (docs/design/xavier-speech-bubble-spec.md sections 4, 5 and 7).

  Scenario: A saved expense with a budget shows the receipt and what is left
    Given a "Food" budget of 30 SGD with 5 SGD already spent
    When I save a 5 SGD "expense" to "Food" from "savings"
    Then the receipt headline should be "Saved SGD 5.00 to Food."
    And the receipt line should be "🏷️ Food · savings · Today"
    And the budget state should be "ok"
    And the budget used share should be about 0.17
    And the budget line should read "SGD 25" then "left in Food this month"

  Scenario: An expense over budget is capped and says how far over
    Given a "Entertainment" budget of 150 SGD with 171 SGD already spent
    When I save a 32 SGD "expense" to "Entertainment" from "Visa"
    Then the budget state should be "over"
    And the budget used share should be 1
    And the budget line should read "SGD 21" then "over in Entertainment this month"

  Scenario: A category without a budget gets a receipt and no meter
    Given a "Gifts" category with no budget
    When I save a 45 SGD "expense" to "Gifts" from "OCBC 360"
    Then the receipt headline should be "Saved SGD 45.00 to Gifts."
    And the receipt should have no budget

  Scenario: An expense with no category names the account
    Given a "Food" category with no budget
    When I save a 12 SGD "expense" with no category from "Wallet"
    Then the receipt headline should be "Saved SGD 12.00 to Wallet."
    And the receipt should have no budget

  Scenario: Income says where it came from and never shows an expense budget
    Given a "Food" budget of 30 SGD with 5 SGD already spent
    When I save a 100 SGD "income" to "Food" from "savings" paid by "Acme"
    Then the receipt headline should be "Added SGD 100.00 from Acme."
    And the receipt amount should be coloured "positive"
    And the receipt should have no budget

  Scenario: A transfer names both accounts
    Given a "Food" category with no budget
    When I move 200 SGD from "savings" to "Wallet"
    Then the receipt headline should be "Moved SGD 200.00 from savings to Wallet."
    And the receipt should have no budget

  Scenario: A repeating series says it was set up
    When I save a 15 SGD series titled "Netflix" repeating "monthly"
    Then the bubble text should be "Set up Netflix, SGD 15.00, repeating monthly."

  Scenario: A repeating series without a rule label still reads cleanly
    When I save a 15 SGD series titled "Netflix" repeating ""
    Then the bubble text should be "Set up Netflix, SGD 15.00, repeating."

  Scenario: A budget set in chat says what it is now and what it was
    When I set the "Groceries" budget to 450 USD from 400 USD for "2026-10"
    Then the receipt headline should be "Groceries is now $450 a month."
    And the receipt line should be "Starting October · was $400"

  Scenario: A first budget has no previous amount
    When I set the "Groceries" budget to 450 USD from nothing for "2026-10"
    Then the receipt headline should be "Groceries is now $450 a month."
    And the receipt line should be "Starting October"

  Scenario: Cancelled and discarded confirmations are plain
    Then the discarded text should be "No problem, I didn't save it."
    And the cancelled account update text should be "No problem, I left it as it was."

  Scenario: No confirmation asks "Anything else?"
    When I build every confirmation
    Then none of them should contain "Anything else"

  Scenario: The saved-expense card is gone from the Assistant
    When I read the Assistant sources
    Then nothing should render "SavedBudgetCard"
