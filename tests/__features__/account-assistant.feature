Feature: Assistant account-creation flow (/account)
  The pure Q&A brain behind the "/account" command: recognising the command,
  walking name -> type -> starting balance, and reading answers deterministically
  into a ready-to-create account draft.

  Scenario: "/account" is recognised as the account command
    Then "/account" is an account command
    And "/account savings" is an account command
    And "spent 10 at the shop" is not an account command

  Scenario: The flow walks name, type, then balance to a ready draft
    When I start the account flow
    Then the assistant asks for the account name
    When I answer "DBS Savings"
    Then the assistant asks for the type
    When I answer "savings"
    Then the assistant asks for the starting balance
    When I answer "500"
    Then the account draft is ready
    And the ready account name is "DBS Savings"
    And the ready account subtype is "savings"
    And the ready account opening balance is 50000

  Scenario: "credit card" normalises to a credit_card subtype
    When I start the account flow
    And I answer "Amex"
    And I answer "credit card"
    And I answer "none"
    Then the ready account subtype is "credit_card"
    And the ready account opening balance is 0

  Scenario: Skipping the type leaves it unset
    When I start the account flow
    And I answer "Cash jar"
    And I answer "skip"
    And I answer "0"
    Then the ready account has no subtype

  Scenario: An "owe" balance is stored negative
    When I resolve the opening balance from "owe 200"
    Then the opening balance should be -20000

  Scenario: A plain dollar amount opening balance
    When I resolve the opening balance from "$1,250.50"
    Then the opening balance should be 125050

  Scenario: An empty name is re-asked
    When I start the account flow
    And I answer ""
    Then the assistant asks for the account name
    And the account draft is not ready

  Scenario: "/transactions" yields its body for expense parsing
    Then the transaction command body of "/transactions lunch 10 at subway" is "lunch 10 at subway"
    And the transaction command body of "spent 10" is null
